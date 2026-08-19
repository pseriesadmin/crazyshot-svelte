import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { sendPaymentCompletedAdminPush, sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

// PG 미연동 임시 자동 예약승인 (M3 결제 연동 전 시범서비스용)
// hold 상태의 예약을 confirmed로 전환하고 채팅 알림을 발송한다
// reservationIds는 필수 — 현재 결제 확정 대상으로 지정된 예약 건만 확정한다.
// (BL-CHAT-C4 수정: 과거의 "미전달 시 하위호환 — 사용자 hold 전체 확정" fallback 제거.
//  파라미터 누락 시 무관한 과거 hold 예약까지 일괄 승인되는 것을 방지하기 위해 400으로 거부한다.)
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ success: false, error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const requestedIds = Array.isArray(body.reservationIds)
    ? (body.reservationIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
    : null
  const userCouponId = typeof body.userCouponId === 'string' ? body.userCouponId : null
  // 2026-08-19(재검수): 장바구니에서 선택한 포인트가 화면 표시에만 쓰이고 실제로 차감되지
  // 않던 결함 수정 — Migration 303 use_points RPC로 결제승인 시점에 쿠폰과 동일하게 소진
  const pointsUsed = Number.isFinite(Number(body.pointsUsed)) ? Math.max(0, Math.trunc(Number(body.pointsUsed))) : 0

  if (requestedIds === null) {
    return json({ success: false, error: 'reservationIds가 필요합니다' }, { status: 400 })
  }

  if (requestedIds.length === 0) {
    return json({ success: false, error: '선택된 예약이 없습니다', confirmedCount: 0, confirmedReservations: [] })
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: holds, error: fetchErr } = await admin
    .from('rental_reservations')
    .select('id, reservation_code')
    .eq('user_id', session.user.id)
    .eq('status', 'hold')
    .in('id', requestedIds)

  if (fetchErr) return json({ success: false, error: '예약 조회 실패' }, { status: 500 })
  if (!holds?.length) return json({ success: true, confirmedCount: 0, confirmedReservations: [] })

  // 체크된 예약 전체를 하나의 주문(orders/order_items)으로 묶는다 — Migration 251.
  // 실패해도 예약 승인 자체는 진행(주문 그룹핑은 부가 정보이지 승인 전제조건이 아님).
  type CreateOrderRpcFn = (
    name: 'create_checkout_order',
    args: { p_user_id: string; p_reservation_ids: number[] }
  ) => Promise<{ data: { order_id: number; order_key: string; final_amount: number }[] | null; error: unknown }>
  const { data: orderRows, error: orderErr } = await (admin.rpc as unknown as CreateOrderRpcFn)(
    'create_checkout_order',
    { p_user_id: session.user.id, p_reservation_ids: holds.map((h) => h.id) }
  )
  if (orderErr) console.error('[checkout/confirm-mock] create_checkout_order 실패:', orderErr)
  const orderKey = orderRows?.[0]?.order_key ?? null
  const orderId  = orderRows?.[0]?.order_id  ?? null

  // 계약서 서명 완료 게이팅(Migration 284): 결제완료만으로는 confirmed 전환 안 됨 —
  // payment_confirmed_at을 기록하고, 계약서명까지 완료된 건만 즉시 confirmed로 전환된다.
  // 계약 미서명 건은 hold 상태 그대로 남고(관리자가 계약서 발송·서명 확인 필요), 배치알림도
  // 발송되지 않는다(rental-lifecycle.md AUTO_NOTIFY는 confirmed 전이 시에만 발송).
  const confirmedReservations: { id: number; reservationCode: string | null }[] = []
  for (const hold of holds) {
    const { data: confirmed, error: rpcErr } = await admin.rpc('mark_reservation_payment_confirmed', {
      p_reservation_id: hold.id
    })
    if (rpcErr) console.error('[checkout/confirm-mock] mark_reservation_payment_confirmed 실패:', rpcErr)
    if (!rpcErr && confirmed === true) {
      confirmedReservations.push({ id: hold.id, reservationCode: hold.reservation_code })
      // 결제완료 관리자 푸시 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
      await sendPaymentCompletedAdminPush(admin, hold.id, session.user.id, 0)
      // 예약승인 고객 푸시 병행 발송 (기존엔 관리자 푸시만 있었음 — 실결제 자동승인 경로에
      // 고객 FCM 푸시가 누락돼 있던 갭 수정, 2026-08-09)
      await sendReservationLifecyclePush(admin, hold.id, 'reservation_approval')
    }
  }

  // 상담채팅 승인 알림 — 대여반출납 옵션 단일화 정책(2026-08-17)에 맞춰 이번 체크아웃 배치로
  // 승인된 예약 전체를 예약 건별 개별 호출이 아닌 단일 RPC 호출로 하나의 통합 카드로 발송
  // (Migration 275 send_rental_chat_notification_batch — 기존 단건 RPC는 다른 알림 타입에서
  // 계속 그대로 사용되므로 건드리지 않음)
  if (confirmedReservations.length > 0) {
    const { data: batchResult, error: batchErr } = await admin.rpc('send_rental_chat_notification_batch', {
      p_reservation_ids: confirmedReservations.map((r) => r.id),
      p_notify_type: 'reservation_approval'
    })
    if (batchErr) {
      console.error('[checkout/confirm-mock] send_rental_chat_notification_batch 실패:', batchErr)
    } else {
      const result = batchResult as { ok: boolean; error?: string } | null
      if (!result?.ok) console.error('[checkout/confirm-mock] send_rental_chat_notification_batch 거부:', result?.error)
    }
  }

  // 선택된 쿠폰 소진 처리 — 예약이 1건 이상 확정된 경우에만 적용
  // (기존 갭: 쿠폰 선택 시 화면상 할인만 표시되고 user_coupons.used_at이 전혀 갱신되지 않아
  //  동일 쿠폰을 무제한 재사용할 수 있었음 — 2026-08-15 세션에서 발견·플래그된 결함 수정)
  let couponUsed = false
  let couponRedeemedCode: string | null = null
  if (userCouponId && confirmedReservations.length > 0) {
    const { data: useResult, error: useErr } = await admin.rpc('use_coupon', {
      p_user_id: session.user.id,
      p_user_coupon_id: userCouponId,
      // 쿠폰 사용을 이번 체크아웃 주문에 연결(migration 297) — CMS "채번내역" 탭에서
      // 예약현황/대여현황으로 랜딩하기 위한 유일한 연결고리. create_checkout_order가
      // 실패해 orderId가 null이면 use_coupon 자체는 정상 진행되고 order_id만 NULL로 남는다.
      p_order_id: orderId,
    })
    if (useErr) {
      console.error('[checkout/confirm-mock] use_coupon 실패:', useErr)
    } else {
      const result = useResult as { ok: boolean; error?: string; redeemed_code?: string | null } | null
      couponUsed = result?.ok === true
      // sequenced 모드 쿠폰만 값이 있음(migration 296) — manual 모드는 null, 기존 동작과 동일
      couponRedeemedCode = result?.redeemed_code ?? null
      if (!couponUsed) console.error('[checkout/confirm-mock] use_coupon 거부:', result?.error)
    }
  }

  // 선택된 포인트 차감 — 쿠폰과 동일하게 예약이 1건 이상 확정된 경우에만 적용
  // (2026-08-19 재검수 발견·수정: pointsUsed가 화면 표시에만 쓰이고 user_profiles.points가
  //  전혀 차감되지 않아 동일 포인트를 무제한 재사용할 수 있었음 — Migration 303 use_points)
  let pointsDeducted = 0
  // 2026-08-19(QA 권고 반영): 기존엔 실패해도 콘솔 로그만 남고 클라이언트가 알 방법이
  // 없었음(쿠폰의 couponUsed와 동일한 기존 갭) — pointsOk를 명시 응답해 클라이언트가
  // "포인트가 요청됐는데 실제로는 차감되지 않은" 상태를 인지할 수 있도록 함
  let pointsOk = true
  if (pointsUsed > 0 && confirmedReservations.length > 0) {
    const { data: pointsResult, error: pointsErr } = await admin.rpc('use_points', {
      p_user_id: session.user.id,
      p_points: pointsUsed,
      p_order_id: orderId,
    })
    if (pointsErr) {
      console.error('[checkout/confirm-mock] use_points 실패:', pointsErr)
      pointsOk = false
    } else {
      const result = pointsResult as { ok: boolean; error?: string; deducted?: number } | null
      if (result?.ok) {
        pointsDeducted = result.deducted ?? 0
      } else {
        console.error('[checkout/confirm-mock] use_points 거부:', result?.error)
        pointsOk = false
      }
    }
  }

  return json({
    success: confirmedReservations.length > 0,
    confirmedCount: confirmedReservations.length,
    confirmedReservations,
    orderKey,
    pointsDeducted,
    pointsOk,
    couponUsed,
    couponRedeemedCode,
  })
}
