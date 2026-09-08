import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'
import type { Coupon } from '$lib/types/database'

export type CouponStats = {
  total_issued: number
  total_active: number
  total_used: number
  total_expired: number
  total_discount_amount: number
  conversion_rate: number
}

export type UsageReportRow = {
  period: string
  coupon_id: string
  coupon_code: string
  coupon_type: string
  issued_count: number
  used_count: number
  conversion_pct: number
}

export type DistributionRow = {
  id: string
  coupon_id: string
  admin_id: string
  target_type: string
  target_meta: Record<string, unknown> | null
  issued_count: number
  created_at: string
  coupons?: {
    code: string | null
    code_mode?: string
    code_series?: { prefix?: string; category_code?: string } | null
  } | null
}

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const tab = url.searchParams.get('tab') ?? 'dashboard'
  const period = (url.searchParams.get('period') as 'day' | 'month' | 'year') ?? 'month'
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString()
  const to   = url.searchParams.get('to')   ?? new Date().toISOString()
  const selectedId = url.searchParams.get('selected') ?? null

  // migration #48·#49·#51 신설 테이블/RPC — 타입 캐스트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = locals.supabase as unknown as any

  // 쿠폰 통계 (확장 — migration #51)
  const { data: statsRaw, error: statsErr } = await admin.rpc('get_coupon_stats')
  if (statsErr) {
    console.error('[cms/promotion/coupon] get_coupon_stats 실패:', statsErr.message)
  }
  const stats: CouponStats = statsRaw ?? {
    total_issued: 0, total_active: 0, total_used: 0,
    total_expired: 0, total_discount_amount: 0, conversion_rate: 0,
  }

  // 쿠폰 목록
  const { data: coupons } = await admin
    .from('coupons')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  // 사용량 리포트 (리포트 탭일 때만)
  let usageReport: UsageReportRow[] = []
  if (tab === 'report') {
    const { data: report, error: reportErr } = await admin.rpc('get_coupon_usage_report', {
      p_period: period,
      p_from: from,
      p_to: to,
    })
    if (reportErr) {
      console.error('[cms/promotion/coupon] get_coupon_usage_report 실패:', reportErr.message)
    }
    usageReport = report ?? []
  }

  // 배포 이력 (발행 관리 탭 하단 접이식 섹션에서 사용)
  let distributions: DistributionRow[] = []
  if (tab === 'manage') {
    const { data: dist } = await admin
      .from('coupon_distributions')
      .select('*, coupons(code, code_mode, code_series)')
      .order('created_at', { ascending: false })
      .limit(100)
    distributions = (dist ?? []) as DistributionRow[]
  }

  // 만료 예정 쿠폰 (7일 이내)
  const soon = new Date(Date.now() + 7 * 86400000).toISOString()
  const { data: expiringSoon } = await admin
    .from('coupons')
    .select('*')
    .is('deleted_at', null)
    .eq('is_active', true)
    .not('valid_until', 'is', null)
    .lte('valid_until', soon)
    .gte('valid_until', new Date().toISOString())
    .order('valid_until')

  // 만료 완료 쿠폰
  const { data: expiredCoupons } = await admin
    .from('coupons')
    .select('*')
    .is('deleted_at', null)
    .not('valid_until', 'is', null)
    .lt('valid_until', new Date().toISOString())
    .order('valid_until', { ascending: false })
    .limit(50)

  return {
    tab, stats, selectedId,
    coupons: (coupons ?? []) as Coupon[],
    usageReport, distributions,
    expiringSoon: (expiringSoon ?? []) as Coupon[],
    expiredCoupons: (expiredCoupons ?? []) as Coupon[],
    period, from, to,
  }
}

export const actions: Actions = {
  // createCoupon 액션은 /cms/promotion/coupon/new 라우트로 이전됨(항목 7, 라우트 분리)

  updateCoupon: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()

    const id                 = String(form.get('id') ?? '')
    const discount_type      = String(form.get('discount_type') ?? 'fixed')
    const discount_value     = Number(form.get('discount_value') ?? 0)
    const max_discount_amount = Number(form.get('max_discount_amount') ?? 0) || null
    const usage_limit        = Number(form.get('usage_limit') ?? 0) || null
    const user_grade_required = String(form.get('user_grade_required') ?? '') || null
    const validity_type      = String(form.get('validity_type') ?? 'fixed_period')
    const valid_from         = String(form.get('valid_from') ?? '') || null
    const valid_until        = String(form.get('valid_until') ?? '') || null

    if (!id) return { ok: false, error: '쿠폰 ID가 없습니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_update_coupon', {
      p_id: id,
      p_discount_type: discount_type,
      p_discount_value: discount_value,
      p_max_discount_amount: max_discount_amount,
      p_usage_limit: usage_limit,
      p_user_grade_required: user_grade_required,
      p_validity_type: validity_type,
      p_valid_from: valid_from,
      p_valid_until: valid_until,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '수정 실패' }
    return { ok: true }
  },

  toggleCoupon: async ({ request, locals }) => {
    const { session: sess2 } = await locals.safeGetSession()
    if (!sess2) return { ok: false, error: '인증 필요' }
    const cmsRole2 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole2 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_toggle_coupon', { p_id: id })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '처리 실패' }
    return { ok: true }
  },

  deleteCoupon: async ({ request, locals }) => {
    const { session: sess3 } = await locals.safeGetSession()
    if (!sess3) return { ok: false, error: '인증 필요' }
    const cmsRole3 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole3 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_delete_coupon', { p_id: id })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '삭제 실패' }
    return { ok: true }
  },

  distributeCoupon: async ({ request, locals }) => {
    const { session: sess4 } = await locals.safeGetSession()
    if (!sess4) return { ok: false, error: '인증 필요' }
    const cmsRole4 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole4 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const coupon_id   = String(form.get('coupon_id') ?? '')
    const target_type = String(form.get('target_type') ?? 'all')
    const targetMetaRaw = form.get('target_meta')
    const target_meta = targetMetaRaw ? JSON.parse(String(targetMetaRaw)) : null

    if (!coupon_id) return { ok: false, error: '쿠폰을 선택하세요.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any

    // specific_user 대상: 이메일 항목을 user_profiles.email 기준으로 UUID 변환
    // (distribute_coupon RPC는 UUID만 받으므로 RPC 자체는 수정하지 않고 호출 전 전처리)
    if (target_type === 'specific_user' && Array.isArray(target_meta?.user_ids)) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const raw = target_meta.user_ids as string[]
      const uuids  = raw.filter(v => UUID_RE.test(v))
      const emails = raw.filter(v => !UUID_RE.test(v))

      if (emails.length > 0) {
        const { data: profiles, error: lookupError } = await db
          .from('user_profiles')
          .select('id, email')
          .in('email', emails)

        if (lookupError) return { ok: false, error: lookupError.message }

        const foundEmails = new Set((profiles ?? []).map((p: { email: string }) => p.email))
        const notFound = emails.filter(e => !foundEmails.has(e))
        if (notFound.length > 0) {
          return { ok: false, error: `일치하는 회원을 찾을 수 없습니다: ${notFound.join(', ')}` }
        }
        uuids.push(...(profiles ?? []).map((p: { id: string }) => p.id))
      }

      target_meta.user_ids = uuids
    }

    const { data, error } = await db.rpc('distribute_coupon', {
      p_coupon_id:   coupon_id,
      p_target_type: target_type,
      p_target_meta: target_meta,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; issued_count?: number; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '배포 실패' }
    return { ok: true, issued_count: result.issued_count }
  },

  extendCoupon: async ({ request, locals }) => {
    const { session: sess5 } = await locals.safeGetSession()
    if (!sess5) return { ok: false, error: '인증 필요' }
    const cmsRole5 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole5 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const coupon_id = String(form.get('coupon_id') ?? '')
    const new_until = String(form.get('new_until') ?? '')

    if (!coupon_id || !new_until) return { ok: false, error: '쿠폰 ID와 새 만료일을 입력하세요.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('extend_coupon', {
      p_coupon_id: coupon_id,
      p_new_until: new_until,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '연장 실패' }
    return { ok: true }
  },
}
