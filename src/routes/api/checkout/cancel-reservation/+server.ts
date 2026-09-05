/**
 * POST /api/checkout/cancel-reservation
 *
 * 고객 셀프 "예약신청취소"
 *   - hold 상태: update_reservation_status(cancelled) — Toss 불필요
 *   - confirmed 상태: cancelReservationWithRefund() — Toss 실환불 + cancel_reservation_payment RPC
 *
 * 취소 가능 조건 (서버가 재계산 — 클라이언트 값 신뢰 금지):
 *   baseEligible = hold || (confirmed + 운송장 미등록)
 *   timeEligible = 배송방식이면 제약 없음, 비배송이면 방문 6시간 전까지
 *
 * IDOR 방지: orders.user_id 조회로 같은 주문 형제예약 전체도 본인 소유 확인
 * (cancel_reservation_payment RPC가 주문 전체를 취소하므로 필수)
 */

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { RequestHandler } from './$types'
import { cancelReservationWithRefund } from '$lib/server/cancelReservationWithRefund'
import { canCancelReservation } from '$lib/utils/canCancelReservation'
import { sendReservationLifecyclePush } from '$lib/server/push'

export const POST: RequestHandler = async ({ locals, request }) => {
  // ─── 인증 ──────────────────────────────────────────────────────────────
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // ─── 요청 파싱 ─────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const reservationId = Number(body.reservationId)
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '예약 ID가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ─── 소유권 확인: 예약 기본 정보 조회 ────────────────────────────────
  const { data: rv } = await admin
    .from('rental_reservations')
    .select('id, status, user_id, tracking_number, pickup_method, start_date, pickup_time')
    .eq('id', reservationId)
    .maybeSingle()

  const reservation = rv as {
    id: number
    status: string
    user_id: string
    tracking_number: string | null
    pickup_method: string | null
    start_date: string | null
    pickup_time: string | null
  } | null

  if (!reservation || reservation.user_id !== session.user.id) {
    return json({ ok: false, error: '예약신청취소가 불가합니다.' }, { status: 403 })
  }

  // ─── IDOR 방지: order_items → orders.user_id 일치 확인 ───────────────
  // cancel_reservation_payment RPC가 같은 주문 전체를 취소하므로 형제예약도 본인 소유여야 함
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id
  if (orderId != null) {
    const { data: orderRow } = await admin
      .from('orders')
      .select('user_id')
      .eq('id', orderId)
      .maybeSingle()
    const orderUserId = (orderRow as { user_id?: string | null } | null)?.user_id
    if (orderUserId && orderUserId !== session.user.id) {
      return json({ ok: false, error: '예약신청취소가 불가합니다.' }, { status: 403 })
    }
  }

  // ─── 수령 방식 배송 여부 조회 ─────────────────────────────────────────
  let isDeliveryType = false
  if (reservation.pickup_method) {
    const { data: methodOpts } = await admin
      .from('rental_method_options')
      .select('is_delivery_type')
      .eq('method_key', reservation.pickup_method)
      .maybeSingle()
    isDeliveryType = (methodOpts as { is_delivery_type?: boolean | null } | null)?.is_delivery_type === true
  }

  // ─── 취소가능 조건 서버 재계산 (클라이언트 canCancel 신뢰 금지) ───────
  const canCancel = canCancelReservation({
    status: reservation.status,
    trackingNumber: reservation.tracking_number,
    isDeliveryType,
    startDate: reservation.start_date,
    pickupTime: reservation.pickup_time,
  })

  if (!canCancel) {
    return json(
      { ok: false, error: '현재는 예약신청취소가 어렵습니다.\n고객센터 채팅으로 문의해주세요.' },
      { status: 403 },
    )
  }

  // ─── hold 상태: Toss 불필요 → update_reservation_status만 ───────────
  if (reservation.status === 'hold') {
    const { data: rpcData, error: rpcErr } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status: 'cancelled',
    })
    if (rpcErr) {
      return json({ ok: false, error: '취소 처리 중 오류가 발생했습니다.' }, { status: 500 })
    }
    const parsed = rpcData as { ok?: boolean; error?: string } | null
    if (!parsed?.ok) {
      return json({ ok: false, error: parsed?.error ?? '취소 처리 중 오류가 발생했습니다.' }, { status: 500 })
    }

    // 알림 (fail-soft)
    try {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: reservationId,
        p_notify_type: 'reservation_cancelled',
      })
    } catch (e) {
      // fail-soft
    }
    try {
      await sendReservationLifecyclePush(admin, reservationId, 'reservation_cancelled')
    } catch (e) {
      // fail-soft
    }

    return json({ ok: true })
  }

  // ─── confirmed 상태: Toss 환불 + cancel_reservation_payment RPC ──────
  const result = await cancelReservationWithRefund({
    reservationId,
    callerId: session.user.id,
    cancelReason: '고객 자가취소(예약신청취소)',
  })

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      TOSS_FAILED: 400,
      RPC_FAILED: 500,
    }
    return json(
      { ok: false, error: result.message },
      { status: statusMap[result.code] ?? 500 },
    )
  }

  return json({ ok: true })
}
