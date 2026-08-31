import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { callTypedRpc } from '$lib/utils/rpc'
import { loadUserCoupons } from '$lib/server/account/loadUserCoupons'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'

interface AccountProfile {
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
  cms_role: string | null
  // 탈회 관련
  withdrawal_status?: string | null
  withdrawal_requested_at?: string | null
  withdrawal_purge_at?: string | null
}

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:rental-status')
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const [profileRes, addressRes, statsRes, recentRentalRes, rentalsRes, cancelsRes, inquiriesRes, wishlistRes, coupons] = await Promise.all([
    locals.supabase
      .from('user_profiles')
      .select('id, email, full_name, avatar_url, phone, birth_date, address, member_code, member_type, membership_grade, credit_score, rental_count, points, allow_rental_alert, allow_benefit_alert, allow_privacy_consent, allow_third_party_consent, identity_type, identity_doc_url, identity_verified_at, is_foreign, foreign_doc_url, foreign_doc_urls, foreign_type, foreign_stay_type, foreign_verified_at, created_at, cms_role, withdrawal_status, withdrawal_requested_at, withdrawal_purge_at')
      .eq('id', session.user.id)
      .maybeSingle(),
    locals.supabase
      .from('user_shipping_addresses')
      .select('id, label, recipient, phone, road_address, detail_address, postal_code, is_default, sort_order, created_at')
      .order('sort_order'),
    (locals.supabase.rpc as unknown as (fn: string, params: Record<string, string>) => Promise<{ data: unknown; error: unknown }>)(
      'get_user_rental_stats', { p_user_id: session.user.id }
    ),
    locals.supabase
      .from('rental_reservations')
      .select('id, status, reservation_code, start_date, end_date, product_id, products(name, category)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // PC 패널용: 대여 목록
    locals.supabase
      .from('rental_reservations')
      .select('id, status, reservation_code, start_date, end_date, created_at, product_id, products(name, category)')
      .eq('user_id', session.user.id)
      .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])
      .order('created_at', { ascending: false })
      .limit(30),
    // PC 패널용: 취소 목록
    locals.supabase
      .from('rental_reservations')
      .select('id, status, reservation_code, start_date, end_date, created_at')
      .eq('user_id', session.user.id)
      .in('status', ['cancelled'])
      .order('created_at', { ascending: false })
      .limit(30),
    // PC 패널용: 빠른 문의 목록
    locals.supabase
      .from('cs_posts')
      .select('id, title, content, category, status, created_at, cs_inquiries(id, response, is_resolution, created_at)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30),
    // 찜 목록
    (locals.supabase.rpc as unknown as (fn: string, params: Record<string, string>) => Promise<{ data: unknown; error: unknown }>)(
      'get_user_wishlists', { p_user_id: session.user.id }
    ),
    loadUserCoupons(locals.supabase, session.user.id),
  ])

  const stats = (statsRes.data as Array<{
    total_count: number; active_count: number; shipping_count: number; done_count: number; cancelled_count: number
  }> | null)?.[0]

  const profile = (profileRes.data ?? null) as AccountProfile | null

  // PC 대여 패널 카드에 "전자계약 확인"(서명완료) / "전자계약 서명하기"(서명대기) 버튼을
  // 노출할지 판단 — 모바일 /account/rental과 동일 헬퍼 공유(loadRentalContractStatus 참고)
  const rentalReservationIds = ((rentalsRes.data ?? []) as Array<Record<string, unknown>>).map(r => r.id as string | number)
  const contractStatus = await loadRentalContractStatus(locals.supabase, rentalReservationIds)

  return {
    user: {
      name: profile?.full_name ?? '고객',
      email: session.user.email ?? '',
    },
    profile,
    isCmsAdmin: !!(profile?.cms_role),
    authEmail: session.user.email ?? null,
    addresses: (addressRes.data ?? []) as Array<{
      id: string; label: string; recipient: string | null; phone: string | null
      road_address: string; detail_address: string | null; postal_code: string | null
      is_default: boolean; sort_order: number; created_at: string
    }>,
    rentalStats: {
      active:    stats?.active_count    ?? 0,
      shipping:  stats?.shipping_count  ?? 0,
      completed: stats?.done_count      ?? 0,
      cancelled: stats?.cancelled_count ?? 0,
    },
    recentRental: (() => {
      const r = recentRentalRes.data as Record<string, unknown> | null
      if (!r) return null
      const product = r.products as { name: string; category: string } | null
      return {
        id:               r.id as number,
        status:           r.status as string,
        reservation_code: r.reservation_code as string,
        start_date:       r.start_date as string | null,
        end_date:         r.end_date as string | null,
        product_name:     product?.name ?? null,
      }
    })(),
    rentals: ((rentalsRes.data ?? []) as Array<Record<string, unknown>>).map(r => {
      const product = r.products as { name: string; category: string } | null
      const status = contractStatus.get(String(r.id))
      return {
        id:                     r.id as string,
        status:                 r.status as string,
        reservation_code:       r.reservation_code as string,
        start_date:             r.start_date as string | null,
        end_date:               r.end_date as string | null,
        created_at:             r.created_at as string,
        product_name:           product?.name ?? null,
        product_category:       product?.category ?? null,
        has_signed_contract:    status?.signed ?? false,
        pending_contract_token: status?.pendingToken ?? null,
      }
    }),
    cancels: (cancelsRes.data ?? []) as Array<{
      id: string; status: string; reservation_code: string
      start_date: string | null; end_date: string | null; created_at: string
    }>,
    inquiries: (inquiriesRes.data ?? []) as Array<{
      id: string; title: string; content: string; category: string; status: string; created_at: string
      cs_inquiries: Array<{ id: string; response: string; is_resolution: boolean; created_at: string }>
    }>,
    wishlists: (wishlistRes.data ?? []) as Array<{
      wishlist_id: string; product_id: string; product_name: string; category: string
      image_url: string; slug: string; price24h: number | null; price12h: number | null; wished_at: string
    }>,
    // TODO(DB): notifications 테이블 미열람 건수 또는 events 집계로 교체
    benefitCount: 3,
    coupons,
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
}
