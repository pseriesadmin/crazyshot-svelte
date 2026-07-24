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

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:rental-status')
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const [profileRes, addressRes, statsRes, recentRentalRes, rentalsRes, cancelsRes, inquiriesRes, wishlistRes] = await Promise.all([
    locals.supabase
      .from('user_profiles')
      .select('id, email, full_name, phone, birth_date, address, member_code, member_type, membership_grade, credit_score, rental_count, points, allow_rental_alert, allow_benefit_alert, allow_privacy_consent, allow_third_party_consent, identity_type, identity_doc_url, identity_verified_at, is_foreign, foreign_doc_url, foreign_verified_at, created_at')
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
      .select('id, status, start_date, end_date')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // PC 패널용: 대여 목록
    locals.supabase
      .from('rental_reservations')
      .select('id, status, reservation_code, start_date, end_date, created_at, orders(order_items(products(name, category)))')
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
  ])

  const stats = (statsRes.data as Array<{
    total_count: number; active_count: number; shipping_count: number; done_count: number
  }> | null)?.[0]

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
    rentalStats: {
      active:    stats?.active_count   ?? 0,
      shipping:  stats?.shipping_count ?? 0,
      completed: stats?.done_count     ?? 0,
      cancelled: 0,
    },
    recentRental: (recentRentalRes.data ?? null) as {
      id: number; status: string; start_date: string; end_date: string
    } | null,
    rentals: ((rentalsRes.data ?? []) as Array<Record<string, unknown>>).map(r => {
      const orders = r.orders as Array<{ order_items: Array<{ products: { name: string; category: string } | null }> }> | null
      const firstProduct = orders?.[0]?.order_items?.[0]?.products ?? null
      return {
        id:               r.id as string,
        status:           r.status as string,
        reservation_code: r.reservation_code as string,
        start_date:       r.start_date as string | null,
        end_date:         r.end_date as string | null,
        created_at:       r.created_at as string,
        product_name:     firstProduct?.name ?? null,
        product_category: firstProduct?.category ?? null,
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
