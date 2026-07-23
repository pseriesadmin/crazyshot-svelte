import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'

interface AccountProfile {
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
  identity_type: string | null
  identity_doc_url: string | null
  identity_verified_at: string | null
  is_foreign: boolean
  foreign_doc_url: string | null
  foreign_verified_at: string | null
  created_at: string | null
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
      .order('sort_order'),
  ])

  return {
    user: {
      name: session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '회원',
      email: session.user.email ?? '',
    },
    profile: (profileRes.data ?? null) as AccountProfile | null,
    authEmail: session.user.email ?? null,
    addresses: (addressRes.data ?? []) as Array<{
      id: string; label: string; recipient: string | null; phone: string | null
      road_address: string; detail_address: string | null; postal_code: string | null
      is_default: boolean; sort_order: number; created_at: string
    }>,
    // TODO(DB): get_user_rental_stats RPC (user_id) 로 교체
    rentalStats: {
      active:    0,
      shipping:  0,
      completed: 0,
      cancelled: 0,
    },
    // TODO(DB): notifications 테이블 미열람 건수 또는 events 집계로 교체
    benefitCount: 3,
  }
}

export const actions: Actions = {
  updateConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '로그인 필요' })

    const form = await request.formData()
    const privacyRaw    = form.get('allow_privacy_consent')
    const thirdPartyRaw = form.get('allow_third_party_consent')

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
