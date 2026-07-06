import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
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
  const { data: statsRaw } = await admin.rpc('get_point_stats')
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
    const { data: rules } = await admin.rpc('get_point_earn_rules')
    earnRules = (rules ?? []) as EarnRule[]
  }

  return {
    tab, stats,
    txRows: (txRows ?? []) as PointTxRow[],
    userBalances, earnRules,
    txType, from, to,
  }
}

export const actions: Actions = {
  grantPoints: async ({ request, locals }) => {
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
    const form = await request.formData()
    const event_type = String(form.get('event_type') ?? '')
    const amount_raw = form.get('amount')
    const rate_raw   = form.get('rate')
    const is_active  = form.get('is_active')
    const mults_raw  = form.get('grade_multipliers')

    if (!event_type) return { ok: false, error: '이벤트 유형이 필요합니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('update_point_earn_rule', {
      p_event_type:        event_type,
      p_amount:            amount_raw !== null ? Number(amount_raw) : null,
      p_rate:              rate_raw   !== null ? Number(rate_raw)   : null,
      p_is_active:         is_active  !== null ? is_active === 'true' : null,
      p_grade_multipliers: mults_raw  ? JSON.parse(String(mults_raw)) : null,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '업데이트 실패' }
    return { ok: true }
  },
}
