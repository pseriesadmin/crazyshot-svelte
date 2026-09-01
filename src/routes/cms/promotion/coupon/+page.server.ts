import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'
import type { Coupon } from '$lib/types/database'

// B-5 로컬 인터페이스: cms_create_coupon RPC payload 명시 (B-0 회피설계 — 전역 타입 계약 복구 아님)
// 이 인터페이스만으로 "무엇을 보내는지" 컴파일러가 필드명 오타·누락을 잡아줌
interface CmsCreateCouponPayload {
  p_code: string | null
  p_code_series: Coupon['code_series']
  p_code_mode: 'manual' | 'sequenced'
  p_type: string
  p_discount_type: string
  p_discount_value: number
  p_usage_limit: number | null
  p_min_purchase_amount: number
  p_valid_from: string | null
  p_valid_until: string | null
  p_description: string | null
  p_min_rental_amount: number
  p_min_rental_days: number
  p_max_discount_amount: number | null
  p_applicable_categories: unknown | null
  p_user_grade_required: string | null
  p_is_first_rental_only: boolean
  p_per_user_limit: number
  p_total_usage_limit: number | null
  p_is_student_only: boolean
  p_is_walk_in_only: boolean
  p_is_subscription_only: boolean
  p_auto_issue_enabled: boolean
  p_auto_issue_schedule: unknown | null
  p_distribution_target: unknown
  p_validity_type: string
  p_allow_with_points: boolean
  p_allow_stacking: boolean
}

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
  coupons?: {
    code: string | null
    code_mode?: string
    code_series?: { prefix?: string; category_code?: string } | null
  } | null
}

// A-2: products/new 이식 타입 (쿠폰 코드 조합그룹 선택 UI)
export type MappingGroupSimple = { id: string; name: string; description: string | null; default_category: string | null }
export type MappingItemSimple = {
  group_id: string
  taxonomy_code_id: string
  combo_row_id: string
  combo_name: string | null
  date_option: 'none' | 'ym' | 'ymd'
  max_sequence: number | null
  parent_max_sequence: number | null
}
export type TaxonomyCodeSimple = { id: string; code: string; name: string; product_category: string | null; depth: number; code_tier?: string | null }

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

  // A-2: 쿠폰 코드 조합그룹·아이템·분류코드 (coupon 전용 분류, products/new 이식)
  // ⚠️ show_in_product_filter는 의도적으로 필터 조건에서 제외했다 — 이 플래그는 이름 그대로
  // "상품등록 화면 노출 여부"를 뜻하는 product 전용 설정이라, 쿠폰 분류 그룹에는 개념적으로
  // 맞지 않는다(products/new 쿼리를 그대로 복붙하면서 이 조건까지 같이 딸려온 게 원인이었음
  // — 실사용 중 "coupon 키로 태깅했는데도 안 보인다" 결함으로 발견, 2026-08-18 Stephen 확인
  // 후 제거 확정). coupon 분류는 is_active만으로 노출 여부를 판단한다.
  const { data: rawGroups } = await serviceAdmin
    .from('code_mapping_groups')
    .select('id, name, description, default_category')
    .eq('default_category', 'coupon')
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  const mappingGroups = (rawGroups ?? []) as MappingGroupSimple[]

  let mappingItems: MappingItemSimple[] = []
  let taxonomyCodes: TaxonomyCodeSimple[] = []
  if (mappingGroups.length > 0) {
    const groupIds = mappingGroups.map((g) => g.id)
    const { data: rawItems } = await serviceAdmin
      .from('code_mapping_items')
      .select('group_id, taxonomy_code_id, combo_row_id, combo_name, date_option, max_sequence, parent_max_sequence')
      .in('group_id', groupIds)
    mappingItems = (rawItems ?? []) as MappingItemSimple[]

    const codeIds = [...new Set(mappingItems.map((i) => i.taxonomy_code_id))]
    if (codeIds.length > 0) {
      const { data: codes } = await serviceAdmin
        .from('product_category_codes')
        .select('id, code, name, product_category, depth, code_tier')
        .in('id', codeIds)
        .eq('is_active', true)
        .is('deleted_at', null)
      taxonomyCodes = (codes ?? []) as TaxonomyCodeSimple[]
    }
  }

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
    categoryOptions,
    mappingGroups,
    mappingItems,
    taxonomyCodes,
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

    // B-5: code_mode / code_series 읽기 (Part A UI에서 hidden input으로 전달)
    const codeMode = (String(form.get('code_mode') ?? 'manual') as 'manual' | 'sequenced')
    const codeSeriesRaw = form.get('code_series')
    const code_series: Coupon['code_series'] = codeSeriesRaw
      ? JSON.parse(String(codeSeriesRaw))
      : null

    // B-5: 클라이언트사이드 검증 — code_mode별 분기
    if (codeMode === 'manual' && !code) {
      return { ok: false, error: '쿠폰 코드는 필수입니다.' }
    }
    if (codeMode === 'sequenced' && !code_series) {
      return { ok: false, error: '지연채번 모드에서는 코드 분류 선택이 필수입니다.' }
    }

    // B-0 회피설계: payload 객체를 로컬 인터페이스로 명시 (전역 타입 계약 복구는 범위 밖)
    const payload: CmsCreateCouponPayload = {
      p_code:                   codeMode === 'manual' ? (code || null) : null,
      p_code_series:            codeMode === 'sequenced' ? code_series : null,
      p_code_mode:              codeMode,
      p_type:                   type,
      p_discount_type:          discount_type,
      p_discount_value:         discount_value,
      p_usage_limit:            usage_limit,
      p_min_purchase_amount:    min_purchase_amount,
      p_valid_from:             valid_from,
      p_valid_until:            valid_until,
      p_description:            description,
      p_min_rental_amount:      min_rental_amount,
      p_min_rental_days:        min_rental_days,
      p_max_discount_amount:    max_discount_amount,
      p_applicable_categories:  applicable_categories,
      p_user_grade_required:    user_grade_required,
      p_is_first_rental_only:   is_first_rental_only,
      p_per_user_limit:         per_user_limit,
      p_total_usage_limit:      total_usage_limit,
      p_is_student_only:        is_student_only,
      p_is_walk_in_only:        is_walk_in_only,
      p_is_subscription_only:   is_subscription_only,
      p_auto_issue_enabled:     auto_issue_enabled,
      p_auto_issue_schedule:    auto_issue_schedule,
      p_distribution_target:    distribution_target,
      p_validity_type:          validity_type,
      p_allow_with_points:      allow_with_points,
      p_allow_stacking:         allow_stacking,
    }

    // 클라이언트 캐스팅은 기존 관례 유지 (전역 타입 계약 복구는 B-0 범위 밖)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_create_coupon', payload)

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '생성 실패' }
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
