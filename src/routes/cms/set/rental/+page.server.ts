import { fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  display_order: number
  is_active: boolean
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

export const load: PageServerLoad = async ({ locals }) => {
  const supabase = locals.supabase

  const [periods, methods, branches, guide, consents] = await Promise.all([
    untypedFrom(supabase, 'rental_period_options')
      .select('id, name, display_order, is_active')
      .is('deleted_at', null)
      .order('display_order'),

    untypedFrom(supabase, 'rental_method_options')
      .select('id, name, display_order, is_active')
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
  ])

  type GuideRow = { guide_text: string | null }

  return {
    periods: ((periods as { data: RentalPeriodOption[] | null }).data ?? []),
    methods: ((methods as { data: RentalMethodOption[] | null }).data ?? []),
    branches: (branches.data ?? []) as PickupPoint[],
    guideText: ((guide as { data: GuideRow | null }).data?.guide_text ?? ''),
    consents: ((consents as { data: RentalConsentItem[] | null }).data ?? []),
  }
}

export const actions: Actions = {
  // ─── 대여 기간 조건 ───────────────────────────
  addPeriod: async ({ request, locals }) => {
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
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_rental_period_option_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_period_option', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderPeriods: async ({ request, locals }) => {
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
    const data = await request.formData()
    const name = (data.get('name') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (!name) return fail(400, { error: '대여방식명을 입력해주세요.' })
    if (count >= 10) return fail(400, { error: '대여 방식은 최대 10개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_method_option', {
      p_id: null,
      p_name: name,
      p_display_order: count,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  deleteMethod: async ({ request, locals }) => {
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_rental_method_option_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_method_option', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderMethods: async ({ request, locals }) => {
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_method_options', { p_ids: ids })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 지점 정보 ────────────────────────────────
  addBranch: async ({ request, locals }) => {
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
    const data = await request.formData()
    const id = data.get('id') as string
    const { data: inUse } = await untypedRpc(locals.supabase, 'check_pickup_point_in_use', { p_id: id })
    if (inUse) return fail(409, { error: '이미 상품정보에 적용중입니다.' })
    const { error } = await untypedRpc(locals.supabase, 'delete_pickup_point', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ─── 이용안내 ─────────────────────────────────
  saveGuide: async ({ request, locals }) => {
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
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_consent_item', { p_id: id })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  reorderConsents: async ({ request, locals }) => {
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_consent_items', { p_ids: ids })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },
}
