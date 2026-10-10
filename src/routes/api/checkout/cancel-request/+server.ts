// POST /api/checkout/cancel-request
// 고객 "예약 취소 요청" — 계약완료(서명+결제 후) 예약의 취소 요청 접수(2026-10-09: 마감 전·후 통합, 환불은 관리자 승인 시).
//
// 처리: 고객이 [취소 요청]을 누르면 그 고객의 채팅 세션에 '취소 요청' 대화카드(cancel_request)를
// 고객 발신 메시지로 남긴다 — 세션은 고객·관리자가 공유하므로 고객 본인 채팅창에는 "보낸 카드"로,
// 관리자 상담 화면에는 "받은 카드"로 동시에 노출된다. 관리자는 채팅 세션에서 직접 확인·수동 처리한다
// (취소 수수료율·PG 취소는 관리자가 수동으로 결정 — 이 API는 예약 상태·결제를 전혀 바꾸지 않는다).
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { submitCancelRequest } from '$lib/server/cancelRequest'
import { evaluateReservationCancelKind } from '$lib/server/cancelPolicyLoader'
import type { RequestHandler } from './$types'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { reservationId?: unknown }
  const reservationId = Number(body.reservationId)
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '예약 ID가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ─── 소유권·기본 정보 ────────────────────────────────────────────────
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

  // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-C)
  await applyParentFieldsToRowProducts([reservation], ['name'], admin)

  if (!reservation || reservation.user_id !== session.user.id) {
    return json({ ok: false, error: '취소 요청이 불가합니다.' }, { status: 403 })
  }

  // ─── 취소 요청 가능 구간(②) 서버 재판정 — 클라이언트 값 불신 ─────────────
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id ?? null

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

  // hold(신청대기)는 결제 전이라 요청이 아니라 즉시 취소 대상
  if (reservation.status === 'hold') {
    return json(
      { ok: false, code: 'use_cancel', error: '지금은 [예약 취소]로 바로 취소할 수 있습니다.' },
      { status: 409 },
    )
  }
  // 마감 전(free)·마감 후(after_deadline) 모두 요청 접수 — 대여 시작 후·운송장 등록은 고객센터 문의
  if (kind !== 'free' && kind !== 'after_deadline') {
    return json(
      { ok: false, code: kind, error: '취소 요청이 어려운 예약입니다.\n고객센터 채팅으로 문의해주세요.' },
      { status: 403 },
    )
  }

  const result = await submitCancelRequest(
    admin,
    session.user.id,
    {
      id: reservation.id,
      reservation_code: reservation.reservation_code,
      productName: reservation.products?.name ?? null,
      start_date: reservation.start_date,
      end_date: reservation.end_date,
    },
    orderId,
  )
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 })
  return json(result.duplicate ? { ok: true, duplicate: true } : { ok: true })
}
