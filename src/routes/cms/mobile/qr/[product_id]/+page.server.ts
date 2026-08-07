import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { redirect, error, fail } from '@sveltejs/kit'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import { processRentalQrTransition } from '$lib/server/rentalQrTransition'
import type { Actions, PageServerLoad } from './$types'

// 반출 전 ~ 반납 직전까지 처리 가능한 상태
const ACTIVE_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned']

// QR-CONTENT-1: UUID vs product_code 판별
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const load: PageServerLoad = async ({ params, parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(getSupabaseUrl(), SUPABASE_SERVICE_ROLE_KEY)

  // QR-CONTENT-1: params.product_id가 UUID가 아니면 product_code로 조회 (하위호환)
  // QR-CASE-1: product_code는 'CSPARall00001'처럼 date_part('all')가 소문자로 섞여 들어갈 수
  // 있어(§2-3) toUpperCase() 강제 대문자 변환 후 비교하면 대소문자 불일치로 매칭 실패함 —
  // ilike로 대소문자 무관 정확 매칭
  let productId = params.product_id
  if (!UUID_RE.test(productId)) {
    const { data: codeRow } = await admin
      .from('products')
      .select('id')
      .ilike('product_code', escapeLikePattern(productId))
      .is('deleted_at', null)
      .maybeSingle()
    if (!codeRow) throw error(404, '상품을 찾을 수 없습니다.')
    productId = (codeRow as { id: string }).id
  }

  // 1. 상품 조회
  const { data: product, error: pErr } = await admin
    .from('products')
    .select('id, name, product_code')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle()

  if (pErr || !product) throw error(404, '상품을 찾을 수 없습니다.')

  // 2. 활성 예약 조회 — product_id = 자식(재고 단위) UUID 직접 매칭
  //    ⚠️ rental_reservations에 deleted_at 컬럼 없음 → .is('deleted_at', null) 절대 금지
  //    QR-1: 가장 오래된(먼저 시작된) 진행중 예약 기준 — ascending: true
  const { data: rsv } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, status, start_date, end_date, pickup_method, return_method, user_id')
    .eq('product_id', productId)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // 3. 고객명 조회 (user_profiles.id = rental_reservations.user_id)
  let customerName: string | null = null
  if (rsv?.user_id) {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', rsv.user_id)
      .maybeSingle()
    customerName = (profile as { full_name: string | null } | null)?.full_name ?? null
  }

  return {
    product: product as { id: string; name: string; product_code: string | null },
    activeReservation: rsv
      ? {
          id: rsv.id as unknown as number,
          reservation_code: rsv.reservation_code as string | null,
          status: rsv.status as string,
          start_date: rsv.start_date as string,
          end_date: rsv.end_date as string,
          pickup_method: (rsv.pickup_method ?? '') as string,
          return_method: (rsv.return_method ?? '') as string,
          customer_name: customerName,
        }
      : null,
  }
}

export const actions: Actions = {
  processQrAction: async ({ request, locals, params }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { ok: false as const, message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { ok: false as const, message: '권한 없음' })

    const admin = createClient(getSupabaseUrl(), SUPABASE_SERVICE_ROLE_KEY)
    const fd = await request.formData()
    const reservationId = Number(fd.get('reservation_id'))
    const newStatus = String(fd.get('new_status') ?? '')

    if (!reservationId || !newStatus) return fail(400, { ok: false as const, message: '잘못된 요청' })

    // QR-CONTENT-1 이후 params.product_id는 UUID 또는 product_code 둘 다 가능
    let historyProductId: string | null = UUID_RE.test(params.product_id) ? params.product_id : null
    if (!historyProductId) {
      const { data: pRow } = await admin
        .from('products')
        .select('id')
        .ilike('product_code', escapeLikePattern(params.product_id))
        .is('deleted_at', null)
        .maybeSingle()
      historyProductId = (pRow as { id: string } | null)?.id ?? null
    }

    const result = await processRentalQrTransition(admin, {
      reservationId,
      newStatus,
      productId: historyProductId ?? '',
      userId: session.user.id,
    })
    if (!result.ok) return fail(result.message === '잘못된 요청' ? 400 : 500, { ok: false as const, message: result.message })

    return { ok: true as const, newStatus }
  },
}
