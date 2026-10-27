// POST /api/checkout/cancel-inquiry
// 고객 "취소문의" — 배송형 예약의 배송 당일 09:00(KST) 이후(또는 반출 후) 바로 취소할 수 없을 때,
// 고객 채팅 세션에 '취소 문의' 대화카드(cancel_inquiry)를 고객 발신으로 남겨 담당자에게 전달한다(2026-10-26, Stephen 확정).
// 예약 상태·결제·취소 표식은 전혀 바꾸지 않는다. 카드 CTA 는 고객 화면에서 대여 정보(/account/rental)로 이동한다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { submitCancelInquiry } from '$lib/server/cancelRequest'
import { evaluateReservationCancelKind } from '$lib/server/cancelPolicyLoader'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { reservationId?: unknown }
  const reservationId = Number(body.reservationId)
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '예약 ID가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: rv } = await admin
    .from('rental_reservations')
    .select('id, status, user_id, tracking_number, pickup_method, start_date, end_date, reservation_code, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .maybeSingle()

  const reservation = rv as {
    id: number
    status: string
    user_id: string
    tracking_number: string | null
    pickup_method: string | null
    start_date: string | null
    end_date: string | null
    reservation_code: string | null
    products: { name: string | null } | null
  } | null

  // 자식 재고의 이름은 부모 값을 따른다
  await applyParentFieldsToRowProducts([reservation], ['name'], admin)

  if (!reservation || reservation.user_id !== session.user.id) {
    return json({ ok: false, error: '취소문의가 불가합니다.' }, { status: 403 })
  }

  const { data: orderItem } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id ?? null

  // 서버 재판정 — 클라이언트 값 불신. 문의 가능 구간(inquiry)만 접수한다.
  const kind = await evaluateReservationCancelKind(
    admin,
    {
      id: reservation.id,
      status: reservation.status,
      tracking_number: reservation.tracking_number,
      start_date: reservation.start_date,
      pickup_method: reservation.pickup_method,
    },
    orderId,
    Date.now(),
  )
  if (kind === 'free') {
    return json(
      { ok: false, code: 'use_cancel', error: '지금은 [취소신청]으로 접수할 수 있습니다.' },
      { status: 409 },
    )
  }
  if (kind !== 'inquiry') {
    return json(
      { ok: false, code: kind, error: '취소문의가 어려운 예약입니다.\n고객센터 채팅으로 문의해주세요.' },
      { status: 403 },
    )
  }

  const result = await submitCancelInquiry(admin, session.user.id, {
    id: reservation.id,
    reservation_code: reservation.reservation_code,
    productName: reservation.products?.name ?? null,
    start_date: reservation.start_date,
    end_date: reservation.end_date,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 })
  return json(result.duplicate ? { ok: true, duplicate: true } : { ok: true })
}
