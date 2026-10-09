/**
 * POST /api/checkout/cancel-reservation
 *
 * 고객 셀프 "예약신청취소"
 *   - hold 상태: update_reservation_status(cancelled) — Toss 불필요
 *   - confirmed 상태(서명+결제 후): 즉시 환불하지 않고 취소 요청 접수(관리자 승인·환불은 CMS [예약취소], 2026-10-09)
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
import { submitCancelRequest } from '$lib/server/cancelRequest'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { getCancelKind, worstCancelKind } from '$lib/utils/canCancelReservation'
import { loadOrderSiblingKinds, ruleFromMethodRow } from '$lib/server/cancelPolicyLoader'
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

  // ─── 수령 방식 신청 마감 규칙 조회 ─────────────────────────────────────
  let methodRow: { is_delivery_type?: boolean | null; deadline_time?: string | null } | null = null
  if (reservation.pickup_method) {
    const { data: methodOpts } = await admin
      .from('rental_method_options')
      .select('is_delivery_type, deadline_time')
      .eq('method_key', reservation.pickup_method)
      .maybeSingle()
    methodRow = (methodOpts as { is_delivery_type?: boolean | null; deadline_time?: string | null } | null)
  }

  // ─── 취소가능 조건 서버 재계산 (클라이언트 canCancel 신뢰 금지) ───────
  // 2026-09-30 정책: hold=언제든 / confirmed=수령 신청 마감 전 즉시취소(전액환불),
  // 마감 후·대여 시작일 이후는 고객센터 문의. 같은 주문의 형제 예약은 주문 전체가 함께 취소·환불되므로
  // 가장 엄격한 판정을 따른다.
  const nowMs = Date.now()
  const ownKind = getCancelKind({
    status: reservation.status,
    trackingNumber: reservation.tracking_number,
    startDate: reservation.start_date,
    rule: ruleFromMethodRow(methodRow),
    nowMs,
  })
  const siblingKinds = orderId != null && ownKind === 'free' && reservation.status === 'confirmed'
    ? await loadOrderSiblingKinds(admin, orderId, reservationId, nowMs)
    : []
  const cancelKind = worstCancelKind([ownKind, ...siblingKinds])

  if (cancelKind !== 'free') {
    const error = cancelKind === 'after_start'
      ? '대여가 시작된 예약은 바로 취소할 수 없습니다.\n고객센터 채팅으로 문의해주세요.'
      : cancelKind === 'after_deadline'
        ? '수령 신청 마감이 지나 바로 취소할 수 없습니다.\n고객센터 채팅으로 문의해주세요.'
        : '현재는 예약신청취소가 어렵습니다.\n고객센터 채팅으로 문의해주세요.'
    return json({ ok: false, error }, { status: 403 })
  }

  // 고객 취소 표식(fail-soft) — 마이페이지에서 "취소중"(관리자 취소확인 대기)으로 표시하기 위함.
  // 이번 요청으로 실제 cancelled 전이된 예약만 표식한다(주문 전체 취소 시 형제 포함 — 이전에 관리자가
  // 취소·거부해 이미 cancelled였던 형제를 "고객 취소"로 잘못 표식하지 않도록 전이된 id만 받는다).
  const markCustomerCancelled = async (ids: number[]): Promise<void> => {
    try {
      await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [...new Set(ids)] })
    } catch {
      // fail-soft — 표식 실패해도 취소 자체는 이미 완료됨(목록에서는 바로 "취소" 화면에 표시됨)
    }
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

    await markCustomerCancelled([reservationId])

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

  // ─── confirmed 상태(서명+결제 완료): 즉시 환불하지 않고 "취소 요청"으로 접수 ──────
  // 2026-10-09 정책: 환불·취소는 관리자가 CMS [예약취소]를 실행할 때 처리(관리자 채팅에 취소 요청 카드 발송).
  const { data: prodRow } = await admin
    .from('rental_reservations')
    .select('reservation_code, end_date, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .maybeSingle()
  const pr = prodRow as { reservation_code: string | null; end_date: string | null; products: { name: string | null } | null } | null
  if (pr) await applyParentFieldsToRowProducts([pr], ['name'], admin)

  const result = await submitCancelRequest(
    admin,
    session.user.id,
    {
      id: reservationId,
      reservation_code: pr?.reservation_code ?? null,
      productName: pr?.products?.name ?? null,
      start_date: reservation.start_date,
      end_date: pr?.end_date ?? null,
    },
    orderId ?? null,
  )
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 })

  return json({ ok: true, requested: true })
}
