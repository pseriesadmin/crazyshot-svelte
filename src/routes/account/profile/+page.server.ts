import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { callTypedRpc } from '$lib/utils/rpc'
import { loadUserCoupons } from '$lib/server/account/loadUserCoupons'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
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
  identity_type: string[] | null
  identity_doc_url: string[] | null
  identity_verified_at: string | null
  is_foreign: boolean
  foreign_doc_url: string | null
  foreign_doc_urls: string[] | null
  foreign_type: string[] | null
  foreign_stay_type: string | null
  foreign_verified_at: string | null
  created_at: string | null
  // 탈회 관련
  withdrawal_status?: string | null
  withdrawal_requested_at?: string | null
  withdrawal_purge_at?: string | null
  withdrawal_purged_at?: string | null
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

  // relative_days("첫 확인일로부터 N일") 쿠폰: 이 화면에서 쿠폰 목록을 열어보는 시점을
  // "첫 확인"으로 기록해 유효일수 카운트다운을 시작한다 — 장바구니(cart/+page.server.ts)와
  // 동일 패턴, 아래 loadUserCoupons 조회보다 먼저 호출해야 방금 기록된 first_viewed_at이
  // 그 조회에 바로 반영된다. 오류가 나도 나머지 화면 로드를 막지 않는다(fail-soft).
  // mark_coupons_first_viewed는 Migration #518 신규 RPC — 타입 재생성 전까지 캐스트 사용
  // (cart/+page.server.ts와 동일 워크어라운드).
  // 2026-09-21(긴급 수정) — supabase.rpc(...)가 반환하는 PostgrestFilterBuilder는 .catch
  // 메서드를 직접 노출하지 않아 ".catch is not a function" TypeError로 이 화면 전체가
  // 500 오류를 내고 있었다(사용자 실보고로 발견). 페일소프트 의도는 try/await로 유지하고
  // .catch() 체이닝만 제거.
  type RpcCallable = (name: string, args: Record<string, string>) => Promise<unknown>
  try {
    await (locals.supabase.rpc as unknown as RpcCallable)(
      'mark_coupons_first_viewed', { p_user_id: session.user.id }
    )
  } catch {
    // fail-soft — RPC 실패해도 나머지 화면 로드는 계속 진행
  }

  const [profileRes, addressRes, coupons] = await Promise.all([
    locals.supabase
      .from('user_profiles')
      .select('id, email, full_name, avatar_url, phone, birth_date, address, member_code, member_type, membership_grade, credit_score, rental_count, points, allow_rental_alert, allow_benefit_alert, allow_privacy_consent, allow_third_party_consent, identity_type, identity_doc_url, identity_verified_at, is_foreign, foreign_doc_url, foreign_doc_urls, foreign_type, foreign_stay_type, foreign_verified_at, created_at, withdrawal_status, withdrawal_requested_at, withdrawal_purge_at, withdrawal_purged_at')
      .eq('id', session.user.id)
      .maybeSingle(),
    locals.supabase
      .from('user_shipping_addresses')
      .select('id, label, recipient, phone, road_address, detail_address, postal_code, is_default, sort_order, created_at')
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    loadUserCoupons(locals.supabase, session.user.id),
  ])

  if (profileRes.error) {
    console.error('[profile/load] user_profiles error:', profileRes.error)
  }

  return {
    profile: (profileRes.data ?? null) as UserProfile | null,
    authEmail: session.user.email ?? null,
    addresses: (addressRes.data ?? []) as ShippingAddress[],
    coupons,
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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'add_shipping_address',
      {
        p_label:          label || '추가',
        p_recipient:      recipient  || null,
        p_phone:          phone      || null,
        p_road_address:   road_address,
        p_detail_address: detail_address || null,
        p_postal_code:    postal_code    || null,
        p_set_default:    set_default,
      },
    )

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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'delete_shipping_address',
      { p_address_id: address_id },
    )

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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'update_user_profile',
      { p_full_name: full_name, p_email: email, p_birth_date: birth_date },
    )

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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'verify_and_update_phone',
      { p_phone: phone, p_code: code },
    )

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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'set_default_shipping_address',
      { p_address_id: address_id },
    )

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

    const { data, error } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'update_user_consent',
      { p_allow_privacy_consent, p_allow_third_party_consent },
    )

    if (error) return fail(500, { ok: false, error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '저장 실패' })
    return { ok: true }
  },

  requestWithdrawal: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '로그인이 필요합니다.' })

    const form = await request.formData()
    const reasons = form.getAll('reasons').map(String)
    const reasonEtc = String(form.get('reasonEtc') ?? '').trim() || null

    const { data, error } = await callTypedRpc<{
      ok: boolean
      error?: string
      error_code?: string
      purge_at?: string
    }>(locals.supabase, 'request_account_withdrawal', {
      p_reasons: reasons,
      p_reason_etc: reasonEtc,
    })

    if (error) return fail(500, { error: '처리 중 오류가 발생했습니다.' })

    const result = data as {
      ok: boolean
      error?: string
      error_code?: string
      purge_at?: string
    } | null

    if (!result?.ok) {
      return fail(400, { error: result?.error, error_code: result?.error_code })
    }

    return { success: true, purge_at: result.purge_at }
  },
}
