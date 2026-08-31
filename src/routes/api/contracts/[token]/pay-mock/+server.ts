import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import { sendPaymentCompletedAdminPush } from '$lib/server/push'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import type { RequestHandler } from './$types'

// 3단계(계약서명 완료 후) mock 결제 트리거 — TASK.md "예약 결제·계약서명 순서 재설계"
// Phase C(2026-08-21). GATE B Q4 확정: cart 체크아웃(1단계)의 confirm-mock과 별개의 신규
// 엔드포인트로 분리(토큰 기반 단건 예약 컨텍스트가 confirm-mock의 reservationIds 배열
// 기반과 맞지 않음). 내부적으로는 confirm-mock과 동일하게 mark_reservation_payment_confirmed
// /try_confirm_reservation RPC(Migration 284, 시그니처·게이팅 로직 절대 변경 금지)를 그대로
// 재사용한다.
//
// 인증: 계약서명 엔드포인트(/api/contracts/[token]/sign)와 동일한 토큰 기반 — 로그인 세션을
// 요구하지 않는다. /contract/[token] 페이지 자체가 이미 비로그인 접근 가능한 토큰 기반 화면
// (contract.md 정책)이라, 그 화면에서만 노출되는 결제 트리거도 동일한 신뢰 모델(토큰 자체가
// 접근 권한)을 따르는 것이 기존 설계와 일관적이다 — 별도 세션 인증을 추가로 요구하면 오히려
// 토큰만으로 서명은 되는데 결제는 로그인해야 하는 불일치가 생긴다.
export const POST: RequestHandler = async ({ params, request }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: signing, error: findErr } = await admin
    .from('contract_signings')
    .select('id, contract_id, user_id')
    .eq('token', params.token)
    .maybeSingle()

  if (findErr || !signing || !signing.contract_id) {
    return json({ error: '유효하지 않은 서명 링크입니다.' }, { status: 404 })
  }

  const { data: contract } = await admin
    .from('contracts')
    .select('reservation_id')
    .eq('id', signing.contract_id)
    .maybeSingle()

  const reservationId = (contract as { reservation_id?: number | null } | null)?.reservation_id
  if (!reservationId) {
    return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data: reservation, error: resErr } = await admin
    .from('rental_reservations')
    .select('id, status, reservation_code, user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !reservation) {
    return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  }

  const reservationUserId = (reservation as { user_id: string | null }).user_id

  // EC-3: 이미 confirmed(관리자 수동승인 등)이거나 취소·만료 등으로 더 이상 hold가 아니면
  // 결제 트리거를 안전하게 no-op 처리(중복 결제·중복 승인 방지, 멱등)
  if (reservation.status !== 'hold') {
    return json({
      ok:               true,
      confirmed:        reservation.status === 'confirmed',
      alreadyProcessed: true,
      reservationCode:  reservation.reservation_code,
    })
  }

  const body = await request.json().catch(() => ({}))
  const userCouponId = typeof body.userCouponId === 'string' ? body.userCouponId : null
  const pointsUsed = Number.isFinite(Number(body.pointsUsed)) ? Math.max(0, Math.trunc(Number(body.pointsUsed))) : 0

  // 이 예약이 속한 주문(order) — 쿠폰/포인트 소진 연결(migration 297/303)에 사용.
  // create_reservation_order(cart 1단계 체크아웃)가 이미 생성해둔 값을 그대로 조회만 한다.
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  const orderId = (orderItem as { order_id: number | null } | null)?.order_id ?? null

  // 2026-08-31(Migration 397/398): 계약이 주문당 1건만 존재해(init-contract 정책) 이
  // 계약을 소유한 대표 예약뿐 아니라 같은 주문의 형제 예약도 결제 시 함께 payment_confirmed_at을
  // 기록해야 한다 — mark_reservation_payment_confirmed_order가 주문 전체(단일 예약이면
  // 자기 자신만)를 순회하며 결제확인 기록 + 게이팅 재확인을 수행한다. (⚠️ 서명 전용
  // 재확인은 try_confirm_reservation_order를 써야 함 — 이 함수는 결제를 실제로 기록하는
  // 부수효과가 있어 결제가 확정되는 이 시점에만 호출한다.)
  const { data: confirmedIds, error: rpcErr } = await admin.rpc('mark_reservation_payment_confirmed_order', {
    p_reservation_id: reservationId,
  })
  if (rpcErr) {
    console.error('[contracts/pay-mock] mark_reservation_payment_confirmed_order 실패:', rpcErr)
    return json({ error: '결제 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
  const confirmed = ((confirmedIds ?? []) as number[]).includes(reservationId)

  if (confirmed === true && reservationUserId) {
    // 결제완료 관리자 푸시 — 승인 관련 고객 알림과 별도로 즉시 발송
    await sendPaymentCompletedAdminPush(admin, reservationId, reservationUserId, 0)

    // 채팅 알림 + 고객 푸시 — 공용 헬퍼로 통합 (NTF-C2 수정, 2026-08-31)
    // mode='hold' 시 채팅·푸시 둘 다 보류. 푸시는 §4 판정 이후에만 발송 — service-operations.md §4/§15
    const notifyPlan = await resolveApprovalNotifyPlan(admin, reservationId)
    await sendApprovalNotifications(admin, reservationId, notifyPlan)
  }

  // 쿠폰/포인트 소진(Phase C-4) — confirm-mock과 동일하게 실제로 confirmed 전환된 경우에만
  // 적용한다(결제만 되고 서명 미완료라 아직 hold인 상태에서는 소진하지 않음).
  let couponUsed = false
  let couponRedeemedCode: string | null = null
  let couponError: string | null = null
  let pointsDeducted = 0
  let pointsOk = true

  if (confirmed === true && reservationUserId && userCouponId) {
    const { data: useResult, error: useErr } = await admin.rpc('use_coupon', {
      p_user_id:         reservationUserId,
      p_user_coupon_id:  userCouponId,
      p_order_id:        orderId,
    })
    if (useErr) {
      console.error('[contracts/pay-mock] use_coupon 실패:', useErr)
    } else {
      const result = useResult as { ok: boolean; error?: string; redeemed_code?: string | null } | null
      couponUsed = result?.ok === true
      couponRedeemedCode = result?.redeemed_code ?? null
      if (!couponUsed) {
        couponError = result?.error ?? null
        console.error('[contracts/pay-mock] use_coupon 거부:', couponError)
      }
    }
  }

  if (confirmed === true && reservationUserId && pointsUsed > 0) {
    const { data: pointsResult, error: pointsErr } = await admin.rpc('use_points', {
      p_user_id: reservationUserId,
      p_points:  pointsUsed,
      p_order_id: orderId,
    })
    if (pointsErr) {
      console.error('[contracts/pay-mock] use_points 실패:', pointsErr)
      pointsOk = false
    } else {
      const result = pointsResult as { ok: boolean; error?: string; deducted?: number } | null
      if (result?.ok) {
        pointsDeducted = result.deducted ?? 0
      } else {
        console.error('[contracts/pay-mock] use_points 거부:', result?.error)
        pointsOk = false
      }
    }
  }

  return json({
    ok:               true,
    confirmed:        confirmed === true,
    reservationCode:  reservation.reservation_code,
    couponUsed,
    couponRedeemedCode,
    couponError,
    pointsDeducted,
    pointsOk,
  })
}
