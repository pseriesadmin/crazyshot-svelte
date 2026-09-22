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

export type CouponCategoryOption = { value: string; label: string }

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

  // "적용 카테고리" 편집용 선택지(BND-COUPON-CAT-1) — /cms/promotion/coupon/new와 동일 소스·필터
  // (2026-09-21 추가: 발행 후 상세패널에서도 적용 카테고리를 확인·수정할 수 있어야 함)
  const { data: categoryRows } = await admin
    .from('code_mapping_groups')
    .select('default_category, name')
    .not('default_category', 'is', null)
    .eq('is_active', true)
    .eq('show_in_product_filter', true)
    .order('sort_order', { ascending: true })
  const categoryOptions: CouponCategoryOption[] = (categoryRows ?? []).map((r: { default_category: string; name: string }) => ({
    value: r.default_category,
    label: r.name,
  }))

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
    categoryOptions,
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
    // 2026-09-21 수정: "전체 발급 한도"는 생성화면(/cms/promotion/coupon/new)부터 줄곧
    // total_usage_limit 컬럼 기준이었는데, 이 액션만 잘못된 컬럼(usage_limit)을 갱신하고
    // 있었다 — usage_limit은 다른 목적(장바구니 자격조건 검증)으로 쓰이는 별개 컬럼이라
    // 건드리지 않고, 여기서 다루는 필드만 total_usage_limit으로 교정.
    const total_usage_limit  = Number(form.get('total_usage_limit') ?? 0) || null
    const display_name       = String(form.get('display_name') ?? '').trim() || null
    const user_grade_required = String(form.get('user_grade_required') ?? '') || null
    const validity_type      = String(form.get('validity_type') ?? 'fixed_period')
    const valid_from         = String(form.get('valid_from') ?? '') || null
    const valid_until        = String(form.get('valid_until') ?? '') || null

    // 2026-09-21 추가(항목 4 — DetailPanel 노출 누락 필드 발행 후 편집 지원):
    // 생성화면에는 있지만 이 수정 화면에는 없어 발행 후 확인·변경이 불가능했던 필드들
    const description         = String(form.get('description') ?? '').trim() || null
    const min_purchase_amount = Number(form.get('min_purchase_amount') ?? 0)
    const min_rental_amount   = Number(form.get('min_rental_amount') ?? 0)
    const min_rental_days     = Number(form.get('min_rental_days') ?? 0)
    const per_user_limit      = Number(form.get('per_user_limit') ?? 1)
    const applicableRaw       = form.get('applicable_categories')
    const applicable_categories = applicableRaw ? JSON.parse(String(applicableRaw)) : null
    const is_first_rental_only = form.get('is_first_rental_only') === 'true'
    const is_student_only      = form.get('is_student_only') === 'true'
    const is_walk_in_only      = form.get('is_walk_in_only') === 'true'
    const is_subscription_only = form.get('is_subscription_only') === 'true'
    const allow_with_points    = form.get('allow_with_points') !== 'false'
    const allow_stacking       = form.get('allow_stacking') === 'true'
    const valid_days           = Number(form.get('valid_days') ?? 0) || null

    if (!id) return { ok: false, error: '쿠폰 ID가 없습니다.' }

    if (validity_type === 'relative_days' && (!valid_days || valid_days <= 0)) {
      return { ok: false, error: '"첫 확인일로부터 N일" 모드는 유효일수(N)를 1 이상 입력해야 합니다.' }
    }

    // 2026-09-21 추가: coupons_discount_value_check(DB, discount_value>0)는 discount_type과
    // 무관하게 전 유형에 동일 적용된다(/cms/promotion/coupon/new와 동일 가드, §2026-09-21
    // 수정 이력 참고) — 0으로 저장 시도 시 원문 Postgres 에러가 노출되는 것을 선제 차단.
    if (!discount_value || discount_value <= 0) {
      return { ok: false, error: '할인값을 입력해주세요.' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_update_coupon', {
      p_id: id,
      p_discount_type: discount_type,
      p_discount_value: discount_value,
      p_max_discount_amount: max_discount_amount,
      p_total_usage_limit: total_usage_limit,
      p_display_name: display_name,
      p_user_grade_required: user_grade_required,
      p_validity_type: validity_type,
      p_valid_from: valid_from,
      p_valid_until: valid_until,
      p_description: description,
      p_min_purchase_amount: min_purchase_amount,
      p_min_rental_amount: min_rental_amount,
      p_min_rental_days: min_rental_days,
      p_per_user_limit: per_user_limit,
      p_applicable_categories: applicable_categories,
      p_is_first_rental_only: is_first_rental_only,
      p_is_student_only: is_student_only,
      p_is_walk_in_only: is_walk_in_only,
      p_is_subscription_only: is_subscription_only,
      p_allow_with_points: allow_with_points,
      p_allow_stacking: allow_stacking,
      p_valid_days: valid_days,
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
