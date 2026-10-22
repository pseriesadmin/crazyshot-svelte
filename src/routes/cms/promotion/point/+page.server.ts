import { redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'

export type PointStats = {
  total_granted: number
  total_used: number
  total_expired: number
  total_balance: number
  usage_rate: number
  avg_user_balance: number
  monthly_issued: number
  expiring_30d: number
}

export type PointTxRow = {
  id: string
  user_id: string
  type: string
  amount: number
  balance_after: number
  description: string | null
  ref_type: string | null
  admin_id: string | null
  created_at: string
  user_profiles?: { full_name: string | null; phone: string | null } | null
}

export type UserBalanceRow = {
  user_id: string
  points: number
  full_name: string | null
  phone: string | null
}

export type EarnRule = {
  event_type: string
  amount: number
  rate: number
  is_active: boolean
  grade_multipliers: Record<string, number> | null
  description: string | null
  updated_at: string
}

export type PointUseSettingsRow = {
  use_enabled: boolean
  min_use_points: number
  use_unit: number
  max_use_ratio: number
  /** 자동 소멸 기한(적립일로부터 N일) — 0이면 소멸 없음 (Migration #742) */
  expiry_days: number
}

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const tab = url.searchParams.get('tab') ?? 'dashboard'
  const txType = url.searchParams.get('txType') ?? 'all'
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString()
  const to   = url.searchParams.get('to')   ?? new Date().toISOString()

  // migration #46·#50·#51 신설 테이블/RPC — 타입 캐스트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = locals.supabase as unknown as any

  // 포인트 통계 (확장 — migration #51)
  const { data: statsRaw, error: statsErr } = await admin.rpc('get_point_stats')
  if (statsErr) {
    console.error('[cms/promotion/point] get_point_stats 실패:', statsErr.message)
  }
  const stats: PointStats = statsRaw ?? {
    total_granted: 0, total_used: 0, total_expired: 0,
    total_balance: 0, usage_rate: 0, avg_user_balance: 0,
    monthly_issued: 0, expiring_30d: 0,
  }

  // 이력 (최근 50건 — 필터 적용)
  let txQuery = admin
    .from('point_transactions')
    .select('*, user_profiles(full_name, phone)')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .limit(50)

  if (txType !== 'all') {
    txQuery = txQuery.eq('type', txType)
  }

  const { data: txRows } = await txQuery

  // 사용자별 잔량 (탭4 전용)
  let userBalances: UserBalanceRow[] = []
  if (tab === 'balance') {
    const { data: bal } = await admin
      .from('user_profiles')
      .select('user_id, points, full_name, phone')
      .gt('points', 0)
      .order('points', { ascending: false })
      .limit(100)
    userBalances = (bal ?? []) as UserBalanceRow[]
  }

  // 적립 규칙 (탭5 전용)
  let earnRules: EarnRule[] = []
  if (tab === 'rules') {
    const { data: rules, error: rulesErr } = await admin.rpc('get_point_earn_rules')
    if (rulesErr) {
      console.error('[cms/promotion/point] get_point_earn_rules 실패:', rulesErr.message)
    }
    earnRules = (rules ?? []) as EarnRule[]
  }

  // 사용 규칙 (탭6 전용) — 포인트 사용 ON/OFF·최소·단위·최대 비율 (Migration #639)
  let pointUseSettings: PointUseSettingsRow | null = null
  if (tab === 'use') {
    const { data: useRules, error: useErr } = await admin.rpc('get_point_use_settings')
    if (useErr) {
      console.error('[cms/promotion/point] get_point_use_settings 실패:', useErr.message)
    }
    pointUseSettings = (useRules ?? { use_enabled: true, min_use_points: 0, use_unit: 1, max_use_ratio: 100, expiry_days: 0 }) as PointUseSettingsRow
  }

  return {
    tab, stats,
    txRows: (txRows ?? []) as PointTxRow[],
    userBalances, earnRules, pointUseSettings,
    txType, from, to,
  }
}

export const actions: Actions = {
  grantPoints: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const user_id    = String(form.get('user_id') ?? '').trim()
    const amount_raw = Number(form.get('amount') ?? 0)
    const tx_type    = String(form.get('tx_type') ?? 'admin_grant')
    const description = String(form.get('description') ?? '').trim()

    if (!user_id) return { ok: false, error: '사용자 ID가 필요합니다.' }
    if (!amount_raw || amount_raw <= 0) return { ok: false, error: '0보다 큰 금액을 입력하세요.' }

    const amount = tx_type === 'admin_deduct' ? -amount_raw : amount_raw

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('admin_grant_points', {
      p_user_id: user_id,
      p_amount: amount,
      p_type: tx_type,
      p_description: description || null,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string; new_balance?: number } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '처리 실패' }
    return { ok: true, new_balance: result?.new_balance }
  },

  bulkGrantPoints: async ({ request, locals }) => {
    const { session: sess2 } = await locals.safeGetSession()
    if (!sess2) return { ok: false, error: '인증 필요' }
    const cmsRole2 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole2 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const grantsRaw = String(form.get('grants') ?? '[]')

    let grants: { user_id: string; amount: number; description?: string }[]
    try {
      grants = JSON.parse(grantsRaw)
    } catch {
      return { ok: false, error: 'CSV 파싱 오류' }
    }

    if (!grants.length) return { ok: false, error: '발행 데이터가 없습니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('admin_bulk_grant_points', {
      p_grants: grants,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { total_processed: number; success_count: number; fail_count: number } | null
    return { ok: true, result }
  },

  updateEarnRule: async ({ request, locals }) => {
    const { session: sess3 } = await locals.safeGetSession()
    if (!sess3) return { ok: false, error: '인증 필요' }
    const cmsRole3 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole3 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const event_type = String(form.get('event_type') ?? '')
    const amount_raw = form.get('amount')
    const rate_raw   = form.get('rate')
    const is_active  = form.get('is_active')

    if (!event_type) return { ok: false, error: '이벤트 유형이 필요합니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('update_point_earn_rule', {
      p_event_type:        event_type,
      p_amount:            amount_raw !== null ? Number(amount_raw) : null,
      p_rate:              rate_raw   !== null ? Number(rate_raw)   : null,
      p_is_active:         is_active  !== null ? is_active === 'true' : null,
      p_grade_multipliers: null,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '업데이트 실패' }
    return { ok: true }
  },

  // 포인트 사용 규칙 저장 — 장바구니·계약서 화면의 입력 제한과 서버(주문 저장·차감)의 강제 규칙이 모두 이 값을 따른다
  saveUseSettings: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const use_enabled = String(form.get('use_enabled') ?? 'true') === 'true'
    const min_use_points = Number(form.get('min_use_points') ?? 0)
    const use_unit = Number(form.get('use_unit') ?? 1)
    const max_use_ratio = Number(form.get('max_use_ratio') ?? 100)
    // 빈 칸은 Number('')=0 → '소멸 없음'으로 조용히 저장되므로 값이 비어 있으면 거절한다(0은 직접 입력해야 함)
    const expiryRaw = String(form.get('expiry_days') ?? '').trim()
    if (expiryRaw === '') return { ok: false, error: '자동 소멸 기한을 입력해 주세요. 소멸 없음은 0을 입력하세요.' }
    const expiry_days = Number(expiryRaw)

    if (!Number.isInteger(min_use_points) || min_use_points < 0) return { ok: false, error: '최소 사용 포인트는 0 이상의 정수여야 합니다.' }
    if (!Number.isInteger(use_unit) || use_unit < 1) return { ok: false, error: '사용 단위는 1 이상의 정수여야 합니다.' }
    if (!Number.isInteger(max_use_ratio) || max_use_ratio < 0 || max_use_ratio > 100) return { ok: false, error: '최대 사용 비율은 0~100 사이의 정수여야 합니다.' }
    if (!Number.isInteger(expiry_days) || expiry_days < 0 || expiry_days > 3650) return { ok: false, error: '자동 소멸 기한은 0~3650 사이의 정수(일)여야 합니다. 0이면 소멸 없음.' }

    // 규칙 변경은 결제 금액에 직접 영향 → DB 함수는 service_role 전용(Migration #641). manager 이상 게이트를 통과한 이 액션만 호출한다.
    const db = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await db.rpc('upsert_point_use_settings', {
      p_use_enabled: use_enabled,
      p_min_use_points: min_use_points,
      p_use_unit: use_unit,
      p_max_use_ratio: max_use_ratio,
      p_expiry_days: expiry_days,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}
