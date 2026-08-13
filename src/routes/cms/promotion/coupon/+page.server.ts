import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'
import type { Coupon } from '$lib/types/database'

export type CouponCategoryOption = { value: string; label: string }

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
  coupons?: { code: string } | null
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

  // BND-COUPON-CAT-1: "적용 카테고리" 선택지는 하드코딩 대신 백오피스(code_mapping_groups)
  // 기준으로 반영 — products/new·subscriptions/new와 동일한 소스·필터 컨벤션
  const serviceAdmin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { data: categoryRows } = await serviceAdmin
    .from('code_mapping_groups')
    .select('default_category, name')
    .not('default_category', 'is', null)
    .eq('is_active', true)
    .eq('show_in_product_filter', true)
    .order('sort_order', { ascending: true })
  const categoryOptions: CouponCategoryOption[] = (categoryRows ?? []).map((r) => ({
    value: r.default_category as string,
    label: r.name,
  }))

  // 쿠폰 통계 (확장 — migration #51)
  const { data: statsRaw } = await admin.rpc('get_coupon_stats')
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
    const { data: report } = await admin.rpc('get_coupon_usage_report', {
      p_period: period,
      p_from: from,
      p_to: to,
    })
    usageReport = report ?? []
  }

  // 배포 이력 (발행 관리 탭 하단 접이식 섹션에서 사용)
  let distributions: DistributionRow[] = []
  if (tab === 'manage') {
    const { data: dist } = await admin
      .from('coupon_distributions')
      .select('*, coupons(code)')
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
    categoryOptions,
  }
}

export const actions: Actions = {
  createCoupon: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()

    const code         = String(form.get('code') ?? '').trim().toUpperCase()
    const type         = String(form.get('type') ?? 'fixed')
    const discount_type  = String(form.get('discount_type') ?? 'fixed')
    const discount_value = Number(form.get('discount_value') ?? 0)
    const usage_limit    = Number(form.get('usage_limit') ?? 0) || null
    const min_purchase_amount = Number(form.get('min_purchase_amount') ?? 0)
    const valid_from   = String(form.get('valid_from') ?? '') || null
    const valid_until  = String(form.get('valid_until') ?? '') || null
    const description  = String(form.get('description') ?? '') || null

    // ─ 확장 필드 ─
    const min_rental_amount    = Number(form.get('min_rental_amount') ?? 0)
    const min_rental_days      = Number(form.get('min_rental_days') ?? 0)
    const max_discount_amount  = Number(form.get('max_discount_amount') ?? 0) || null
    const user_grade_required  = String(form.get('user_grade_required') ?? '') || null
    const per_user_limit       = Number(form.get('per_user_limit') ?? 1)
    const total_usage_limit    = Number(form.get('total_usage_limit') ?? 0) || null
    const validity_type        = String(form.get('validity_type') ?? 'fixed_period')
    const allow_with_points    = form.get('allow_with_points') !== 'false'
    const allow_stacking       = form.get('allow_stacking') === 'true'
    const is_first_rental_only = form.get('is_first_rental_only') === 'true'
    const is_student_only      = form.get('is_student_only') === 'true'
    const is_walk_in_only      = form.get('is_walk_in_only') === 'true'
    const is_subscription_only = form.get('is_subscription_only') === 'true'
    const auto_issue_enabled   = form.get('auto_issue_enabled') === 'true'

    // JSONB 필드
    const applicableRaw = form.get('applicable_categories')
    const applicable_categories = applicableRaw
      ? JSON.parse(String(applicableRaw))
      : null

    const scheduleRaw = form.get('auto_issue_schedule')
    const auto_issue_schedule = auto_issue_enabled && scheduleRaw
      ? JSON.parse(String(scheduleRaw))
      : null

    const distTargetRaw = form.get('distribution_target')
    const distribution_target = distTargetRaw
      ? JSON.parse(String(distTargetRaw))
      : { type: 'all' }

    if (!code) return { ok: false, error: '쿠폰 코드는 필수입니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { error } = await db.from('coupons').insert({
      code, type,
      discount_type, discount_value,
      usage_limit,
      min_purchase_amount,
      valid_from: validity_type === 'unlimited' ? null : valid_from,
      valid_until: validity_type === 'unlimited' ? null : valid_until,
      description,
      is_active: true,
      usage_count: 0,
      // 확장 필드
      min_rental_amount, min_rental_days, max_discount_amount,
      applicable_categories,
      user_grade_required,
      is_first_rental_only,
      per_user_limit, total_usage_limit,
      is_student_only, is_walk_in_only, is_subscription_only,
      auto_issue_enabled, auto_issue_schedule,
      distribution_target,
      validity_type, allow_with_points, allow_stacking,
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

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
    const { error } = await db.from('coupons').update({
      discount_type, discount_value, max_discount_amount,
      usage_limit, user_grade_required, validity_type,
      valid_from:  validity_type === 'unlimited' ? null : valid_from,
      valid_until: validity_type === 'unlimited' ? null : valid_until,
    }).eq('id', id)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  toggleCoupon: async ({ request, locals }) => {
    const { session: sess2 } = await locals.safeGetSession()
    if (!sess2) return { ok: false, error: '인증 필요' }
    const cmsRole2 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole2 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))
    const is_active = form.get('is_active') === 'true'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { error } = await db
      .from('coupons')
      .update({ is_active: !is_active })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
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
    const { error } = await db
      .from('coupons')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
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
