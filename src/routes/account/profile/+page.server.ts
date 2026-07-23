import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  birth_date: string | null
  address: Record<string, string> | null
  member_code: string | null
  member_type: string | null
  membership_grade: string
  credit_score: number
  rental_count: number
  points: number
  allow_rental_alert: boolean
  allow_benefit_alert: boolean
  allow_privacy_consent: boolean
  allow_third_party_consent: boolean
  // 본인증명·외국인증명
  identity_type: string | null
  identity_doc_url: string | null
  identity_verified_at: string | null
  is_foreign: boolean
  foreign_doc_url: string | null
  foreign_verified_at: string | null
  created_at: string | null
}

export interface ShippingAddress {
  id: string
  label: string
  recipient: string | null
  phone: string | null
  road_address: string
  detail_address: string | null
  postal_code: string | null
  is_default: boolean
  sort_order: number
  created_at: string
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const [profileRes, addressRes] = await Promise.all([
    locals.supabase
      .from('user_profiles')
      .select('id, email, full_name, phone, birth_date, address, member_code, member_type, membership_grade, credit_score, rental_count, points, allow_rental_alert, allow_benefit_alert, allow_privacy_consent, allow_third_party_consent, identity_type, identity_doc_url, identity_verified_at, is_foreign, foreign_doc_url, foreign_verified_at, created_at')
      .eq('id', session.user.id)
      .maybeSingle(),
    locals.supabase
      .from('user_shipping_addresses')
      .select('id, label, recipient, phone, road_address, detail_address, postal_code, is_default, sort_order, created_at')
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (profileRes.error) {
    console.error('[profile/load] user_profiles error:', profileRes.error)
  }

  return {
    profile: (profileRes.data ?? null) as UserProfile | null,
    authEmail: session.user.email ?? null,
    addresses: (addressRes.data ?? []) as ShippingAddress[],
  }
}

export const actions: Actions = {
  addAddress: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const label          = String(form.get('label')          ?? '').trim()
    const recipient      = String(form.get('recipient')      ?? '').trim()
    const phone          = String(form.get('phone')          ?? '').trim()
    const road_address   = String(form.get('road_address')   ?? '').trim()
    const detail_address = String(form.get('detail_address') ?? '').trim()
    const postal_code    = String(form.get('postal_code')    ?? '').trim()
    const set_default    = form.get('set_default') === 'true'

    if (!road_address) return fail(400, { ok: false, error: '기본주소는 필수입니다.' })

    const { data, error } = await locals.supabase.rpc('add_shipping_address', {
      p_label:          label || '추가',
      p_recipient:      recipient  || null,
      p_phone:          phone      || null,
      p_road_address:   road_address,
      p_detail_address: detail_address || null,
      p_postal_code:    postal_code    || null,
      p_set_default:    set_default,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '등록 실패' })
    return { ok: true }
  },

  deleteAddress: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const address_id = String(form.get('address_id') ?? '').trim()
    if (!address_id) return fail(400, { ok: false, error: 'address_id 필수' })

    const { data, error } = await locals.supabase.rpc('delete_shipping_address', {
      p_address_id: address_id,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '삭제 실패' })
    return { ok: true }
  },

  updateProfile: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const full_name  = String(form.get('full_name')  ?? '').trim() || null
    const email      = String(form.get('email')      ?? '').trim() || null
    const birth_date = String(form.get('birth_date') ?? '').trim() || null

    // 이메일 기본 검증
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { ok: false, error: '올바른 이메일 형식을 입력해 주세요.' })
    }

    const { data, error } = await locals.supabase.rpc('update_user_profile', {
      p_full_name:  full_name,
      p_email:      email,
      p_birth_date: birth_date,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '저장 실패' })
    return { ok: true }
  },

  verifyPhone: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const phone = String(form.get('phone') ?? '').replace(/[^0-9]/g, '')
    const code  = String(form.get('code')  ?? '').trim()

    if (!phone || !code) return fail(400, { ok: false, error: '전화번호와 인증번호를 입력해 주세요.' })

    const { data, error } = await locals.supabase.rpc('verify_and_update_phone', {
      p_phone: phone,
      p_code:  code,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '인증 실패' })
    return { ok: true }
  },

  setDefault: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const address_id = String(form.get('address_id') ?? '').trim()
    if (!address_id) return fail(400, { ok: false, error: 'address_id 필수' })

    const { data, error } = await locals.supabase.rpc('set_default_shipping_address', {
      p_address_id: address_id,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '처리 실패' })
    return { ok: true }
  },

  updateConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const privacyRaw     = form.get('allow_privacy_consent')
    const thirdPartyRaw  = form.get('allow_third_party_consent')

    const p_allow_privacy_consent     = privacyRaw    !== null ? privacyRaw    === 'true' : null
    const p_allow_third_party_consent = thirdPartyRaw !== null ? thirdPartyRaw === 'true' : null

    const { data, error } = await locals.supabase.rpc('update_user_consent', {
      p_allow_privacy_consent,
      p_allow_third_party_consent,
    })

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '저장 실패' })
    return { ok: true }
  },
}
