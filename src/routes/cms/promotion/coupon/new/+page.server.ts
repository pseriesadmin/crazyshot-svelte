import { redirect, fail } from '@sveltejs/kit'
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
  p_display_name: string | null
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

// A-2: products/new 이식 타입 (쿠폰 코드 조합그룹 선택 UI) — 목록 화면(../+page.server.ts)의
// 동명 타입과 각자 독립적으로 선언(products/new · products 목록이 이미 이렇게 분리돼 있는
// 기존 관례를 그대로 따름 — 공용 모듈로 묶는 추가 추상화는 이번 범위가 아님)
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

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const serviceAdmin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // BND-COUPON-CAT-1: "적용 카테고리" 선택지는 하드오코딩 대신 백오피스(code_mapping_groups)
  // 기준으로 반영 — products/new·subscriptions/new와 동일한 소스·필터 컨벤션
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
  // show_in_product_filter는 "상품등록 화면 노출 여부"를 뜻하는 product 전용 설정이라
  // 쿠폰 분류 그룹 필터 조건에는 포함하지 않음(원본 +page.server.ts와 동일 정책)
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

  return { categoryOptions, mappingGroups, mappingItems, taxonomyCodes }
}

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })
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
    const display_name = String(form.get('display_name') ?? '').trim() || null

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

    // 항목 2: "무제한" 모드가 아닌데 시작일/종료일 중 하나라도 비어있으면 RPC 호출 전에
    // 즉시 차단 — coupons.valid_from/valid_until NOT NULL 위반의 Postgres 원문 에러가
    // 그대로 토스트에 노출되던 문제를 방지(무제한 모드는 두 값 다 비어야 정상)
    if (validity_type === 'fixed_period' && (!valid_from || !valid_until)) {
      return fail(400, { error: '시작일과 종료일을 모두 선택해주세요.' })
    }

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

    // B-5: code_mode / code_series 읽기 (콤보 선택 UI에서 hidden input으로 전달)
    const codeMode = (String(form.get('code_mode') ?? 'manual') as 'manual' | 'sequenced')
    const codeSeriesRaw = form.get('code_series')
    const code_series: Coupon['code_series'] = codeSeriesRaw
      ? JSON.parse(String(codeSeriesRaw))
      : null

    // B-5: 클라이언트사이드 검증 — code_mode별 분기
    if (codeMode === 'manual' && !code) {
      return fail(400, { error: '쿠폰 코드는 필수입니다.' })
    }
    if (codeMode === 'sequenced' && !code_series) {
      return fail(400, { error: '지연채번 모드에서는 코드 분류 선택이 필수입니다.' })
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
      p_display_name:           display_name,
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

    if (error) return fail(400, { error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { error: result?.error ?? '생성 실패' })

    throw redirect(303, '/cms/promotion/coupon?tab=manage')
  },
}
