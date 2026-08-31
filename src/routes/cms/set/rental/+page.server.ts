import { fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { syncNationalHolidays } from '$lib/server/holidaySync'
import type { Actions, PageServerLoad } from './$types'

// database.ts에 신규 테이블/RPC 미등록 상태 — generate_typescript_types 이후 제거
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}
function untypedRpc(sb: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  return (sb as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc(fn, args)
}

export interface RentalPeriodOption {
  id: string
  name: string
  display_order: number
  is_active: boolean
}

export interface RentalMethodOption {
  id: string
  name: string
  method_key: string | null
  display_order: number
  is_active: boolean
  is_bulk_delivery: boolean
  // 휴무일 캘린더 제한 대상(택배사 의존 여부) — is_bulk_delivery("요청 A" 전용)와는
  // 별개 목적(감사 RSC-B3, Migration #386). /cart courierClosedMap 적용 방식 판정에만 쓰임.
  is_courier_dependent: boolean
}

export interface PickupPoint {
  id: string
  name: string
  address: string
  phone: string | null
  contact_person: string | null
  is_active: boolean
}

export interface RentalConsentItem {
  id: string
  content: string
  display_order: number
  is_active: boolean
}

export interface RentalShippingSettings {
  enable_round_trip: boolean
  round_trip_fee: number | null
  enable_delivery: boolean
  delivery_fee: number | null
  enable_return: boolean
  return_fee: number | null
  shipping_guide: string
  restrict_return_delivery: boolean
}

export interface DeliveryFeeDiscountTier {
  id: string
  min_rental_amount: number
  condition_types: ('long_term_rental' | 'sale_only_purchase')[]
  discount_rate: number
  is_active: boolean
}

export interface DeliveryCutoffSettings {
  enable_prev_day_check: boolean
  enable_fixed_holidays: boolean
  enable_manual_holidays: boolean
  updated_at: string
}

export interface PublicHolidayRow {
  id: string
  date: string
  name: string
  holiday_type: 'national' | 'manual'
  note: string | null
  is_active: boolean
}

export const load: PageServerLoad = async ({ locals }) => {
  const supabase = locals.supabase
  const todayIso = new Date().toISOString().slice(0, 10)

  const [periods, methods, branches, guide, consents, shippingRow, cutoffRow, holidays, discountTiers] = await Promise.all([
    untypedFrom(supabase, 'rental_period_options')
      .select('id, name, display_order, is_active')
      .is('deleted_at', null)
      .order('display_order'),

    untypedFrom(supabase, 'rental_method_options')
      .select('id, name, method_key, display_order, is_active, is_bulk_delivery, is_courier_dependent')
      .is('deleted_at', null)
      .order('display_order'),

    supabase
      .from('pickup_points')
      .select('id, name, address, phone, contact_person, is_active')
      .is('deleted_at', null)
      .order('created_at'),

    untypedFrom(supabase, 'rental_guide_settings')
      .select('guide_text')
      .limit(1)
      .single(),

    untypedFrom(supabase, 'rental_consent_items')
      .select('id, content, display_order, is_active')
      .is('deleted_at', null)
      .order('display_order'),

    untypedFrom(supabase, 'rental_shipping_settings')
      .select('enable_round_trip, round_trip_fee, enable_delivery, delivery_fee, enable_return, return_fee, shipping_guide, restrict_return_delivery')
      .limit(1)
      .single(),

    untypedFrom(supabase, 'delivery_cutoff_settings')
      .select('enable_prev_day_check, enable_fixed_holidays, enable_manual_holidays, updated_at')
      .limit(1)
      .single(),

    untypedFrom(supabase, 'public_holidays')
      .select('id, date, name, holiday_type, note, is_active')
      .gte('date', todayIso)
      .order('date'),

    untypedFrom(supabase, 'delivery_fee_discount_tiers')
      .select('id, min_rental_amount, condition_types, discount_rate, is_active')
      .is('deleted_at', null)
      .order('created_at'),
  ])

  type GuideRow = { guide_text: string | null }

  return {
    periods: ((periods as { data: RentalPeriodOption[] | null }).data ?? []),
    methods: ((methods as { data: RentalMethodOption[] | null }).data ?? []),
    branches: (branches.data ?? []) as PickupPoint[],
    guideText: ((guide as { data: GuideRow | null }).data?.guide_text ?? ''),
    consents: ((consents as { data: RentalConsentItem[] | null }).data ?? []),
    shippingSettings: ((shippingRow as { data: RentalShippingSettings | null }).data ?? null),
    cutoffSettings: ((cutoffRow as { data: DeliveryCutoffSettings | null }).data ?? null),
    holidays: ((holidays as { data: PublicHolidayRow[] | null }).data ?? []),
    discountTiers: ((discountTiers as { data: DeliveryFeeDiscountTier[] | null }).data ?? []),
  }
}

export const actions: Actions = {
  // ─── 대여 기간 조건 ───────────────────────────
  addPeriod: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const name = (data.get('name') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (!name) return fail(400, { error: '조건명을 입력해주세요.' })
    if (count >= 10) return fail(400, { error: '대여 기간 조건은 최대 10개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_period_option', {
      p_id: null,
      p_name: name,
      p_display_order: count,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deletePeriod: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_rental_period_option_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_period_option', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderPeriods: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_period_options', { p_ids: ids })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 대여 방식 ────────────────────────────────
  addMethod: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const name = (data.get('name') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)
    const methodKey = (data.get('method_key') as string | null)?.trim() || null

    if (!name) return fail(400, { error: '대여방식명을 입력해주세요.' })
    // 2026-08-30: method_key 없이 등록되면 카트의 deliveryTabs/isDeliveryLocked가 이 방식을
    // 전혀 인식하지 못해 카트에 노출도 안 되고 "일괄적용" 토글도 무효과가 되는 결함이었음
    // (감사 RSC-B1) — 필수값으로 강제.
    if (!methodKey) return fail(400, { error: '방식 유형을 선택하세요.' })
    if (count >= 10) return fail(400, { error: '대여 방식은 최대 10개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_method_option', {
      p_id: null,
      p_name: name,
      p_display_order: count,
      p_method_key: methodKey,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deleteMethod: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_rental_method_option_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_method_option', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderMethods: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_method_options', { p_ids: ids })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // 배송대여 수령/반납 일괄 지정 — /cart 반납방식 강제고정+시간선택 비활성화 대상 토글
  toggleBulkDelivery: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'toggle_rental_method_bulk_delivery', { p_id: id })
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  // 휴무일 캘린더 제한 대상(택배사 의존 여부) — is_bulk_delivery("요청 A")와 별개 목적
  // (감사 RSC-B3, 2026-08-30). /cart courierClosedMap 적용 방식 판정 전용.
  toggleCourierDependent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'toggle_rental_method_courier_dependent', { p_id: id })
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  // 대여 제한옵션 — /cart 반납 설정에서 '배송' 반납방식 노출 여부 전역 토글
  toggleReturnDeliveryRestriction: async ({ locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const { error } = await untypedRpc(locals.supabase, 'toggle_return_delivery_restriction', {})
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  // ─── 지점 정보 ────────────────────────────────
  addBranch: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const name = (data.get('name') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (!name) return fail(400, { error: '지점명을 입력해주세요.' })
    if (count >= 20) return fail(400, { error: '지점은 최대 20개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_pickup_point', {
      p_id: null,
      p_name: name,
      p_address: '',
      p_phone: '',
      p_contact_person: '',
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  updateBranch: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const name = (data.get('name') as string | null)?.trim() ?? ''
    const address = (data.get('address') as string | null)?.trim() ?? ''
    const phone = (data.get('phone') as string | null)?.trim() ?? ''
    const contactPerson = (data.get('contact_person') as string | null)?.trim() ?? ''

    if (!name) return fail(400, { error: '지점명을 입력해주세요.' })
    if (contactPerson.length > 10) return fail(400, { error: '담당자명은 최대 10자까지 입력 가능합니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_pickup_point', {
      p_id: id,
      p_name: name,
      p_address: address,
      p_phone: phone,
      p_contact_person: contactPerson,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deleteBranch: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_pickup_point_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_pickup_point', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 배송 설정 ────────────────────────────────
  saveShipping: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()

    const enableRoundTrip = data.get('enable_round_trip') === 'true'
    const roundTripFeeRaw = (data.get('round_trip_fee') as string | null) ?? ''
    const roundTripFee = roundTripFeeRaw !== '' ? parseInt(roundTripFeeRaw, 10) : null

    const enableDelivery = data.get('enable_delivery') === 'true'
    const deliveryFeeRaw = (data.get('delivery_fee') as string | null) ?? ''
    const deliveryFee = deliveryFeeRaw !== '' ? parseInt(deliveryFeeRaw, 10) : null

    const enableReturn = data.get('enable_return') === 'true'
    const returnFeeRaw = (data.get('return_fee') as string | null) ?? ''
    const returnFee = returnFeeRaw !== '' ? parseInt(returnFeeRaw, 10) : null

    const shippingGuide = (data.get('shipping_guide') as string | null) ?? ''

    if (shippingGuide.length > 200) return fail(400, { error: '배송 안내문은 최대 200자까지 입력 가능합니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_shipping_settings', {
      p_enable_round_trip: enableRoundTrip,
      p_round_trip_fee:    roundTripFee,
      p_enable_delivery:   enableDelivery,
      p_delivery_fee:      deliveryFee,
      p_enable_return:     enableReturn,
      p_return_fee:        returnFee,
      p_shipping_guide:    shippingGuide,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 택배 휴무일 캘린더 제어 ───────────────────
  saveCutoffSettings: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()

    const enablePrevDayCheck = data.get('enable_prev_day_check') === 'true'
    const enableFixedHolidays = data.get('enable_fixed_holidays') === 'true'
    const enableManualHolidays = data.get('enable_manual_holidays') === 'true'

    const { error } = await untypedRpc(locals.supabase, 'upsert_delivery_cutoff_settings', {
      p_enable_prev_day_check: enablePrevDayCheck,
      p_enable_fixed_holidays: enableFixedHolidays,
      p_enable_manual_holidays: enableManualHolidays,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  addManualHoliday: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const date = (data.get('date') as string | null) ?? ''
    const note = (data.get('note') as string | null)?.trim() ?? ''

    if (!date) return fail(400, { error: '날짜를 선택해주세요.' })
    if (note.length > 100) return fail(400, { error: '사유는 최대 100자까지 입력 가능합니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_manual_holiday', {
      p_id: null,
      p_date: date,
      p_note: note,
    })
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  deleteManualHoliday: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'delete_manual_holiday', { p_id: id })
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  syncHolidaysNow: async ({ locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류' })
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)

    try {
      const result = await syncNationalHolidays(admin, env.DATA_GO_KR_HOLIDAY_API_KEY)
      return { success: true, ...result }
    } catch (err) {
      const message = err instanceof Error ? err.message : '동기화에 실패했습니다.'
      return fail(500, { error: message })
    }
  },

  // ─── 이용안내 ─────────────────────────────────
  saveGuide: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const guideText = (data.get('guide_text') as string | null) ?? ''

    if (guideText.length > 1000) return fail(400, { error: '안내문은 최대 1,000자까지 입력 가능합니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_guide', {
      p_guide_text: guideText,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 필수 동의문 ──────────────────────────────
  addConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const content = (data.get('content') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (!content) return fail(400, { error: '동의문 내용을 입력해주세요.' })
    if (content.length > 200) return fail(400, { error: '동의문은 최대 200자까지 입력 가능합니다.' })
    if (count >= 10) return fail(400, { error: '필수 동의문은 최대 10개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_consent_item', {
      p_id: null,
      p_content: content,
      p_display_order: count,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deleteConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_consent_item', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderConsents: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_consent_items', { p_ids: ids })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 배송료 우대설정 (최대 5개) ─────────────────
  addDiscountTier: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const amountRaw = (data.get('min_rental_amount') as string | null) ?? ''
    const amount = amountRaw !== '' ? parseInt(amountRaw, 10) : NaN
    const conditionTypesRaw = (data.get('condition_types') as string | null) ?? '[]'
    let conditionTypes: string[] = []
    try {
      conditionTypes = JSON.parse(conditionTypesRaw)
    } catch {
      conditionTypes = []
    }
    const discountKey = (data.get('discount_rate') as string | null) ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (Number.isNaN(amount) || amount < 0) return fail(400, { error: '대여금액을 입력하세요.' })
    const VALID_CONDITION_TYPES = ['long_term_rental', 'sale_only_purchase']
    if (
      !Array.isArray(conditionTypes) ||
      conditionTypes.length === 0 ||
      !conditionTypes.every((c) => VALID_CONDITION_TYPES.includes(c))
    ) {
      return fail(400, { error: '조건을 선택하세요.' })
    }
    const DISCOUNT_RATE_MAP: Record<string, number> = { free: 1, half: 0.5, base: 0 }
    const discountRate = DISCOUNT_RATE_MAP[discountKey]
    if (discountRate === undefined) return fail(400, { error: '우대옵션을 선택하세요.' })
    if (count >= 5) return fail(400, { error: '배송료 우대설정은 최대 5개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_delivery_fee_discount_tier', {
      p_id: null,
      p_min_rental_amount: amount,
      p_condition_types: conditionTypes,
      p_discount_rate: discountRate,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deleteDiscountTier: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'delete_delivery_fee_discount_tier', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },
}
