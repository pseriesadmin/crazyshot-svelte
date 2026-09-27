import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { sendPushToAdmins } from '$lib/server/push'
import type { RequestHandler } from './$types'

// 예약 신청(hold) 시점 주문(orders/order_items) 연결 — Migration 280 create_reservation_order.
// 표시 편의 기능(CMS "대여정보" 탭 통합 표시 기반)이지 예약 성립의 필수 조건이 아니므로,
// 실패해도 500만 반환한다 — 호출부(cart/+page.svelte)는 이 실패로 예약/체크아웃 흐름을
// 막지 않는다(TASK.md 2026-08-17 "예약 신청 시점 주문 연결" 핵심제약).
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const reservationIds = Array.isArray(body.reservationIds)
    ? (body.reservationIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
    : null

  if (!reservationIds || reservationIds.length === 0) {
    return json({ error: 'reservationIds가 필요합니다' }, { status: 400 })
  }

  // 장바구니에서 고른 쿠폰/포인트 — 계약서명 페이지(/contract/[token])가 다시 읽어 미리
  // 선택된 상태로 보여주기 위한 사전선택 캐시(Migration 340). 실제 소진은 여전히 결제
  // 확정 시점(pay-mock)에서만 일어난다.
  const selectedCouponId = typeof body.couponId === 'string' && body.couponId ? body.couponId : null
  const selectedPoints = Number.isFinite(body.points) && body.points > 0 ? Math.floor(body.points) : 0
  // 2026-08-31(Migration 395): 장바구니가 이미 계산해 고객에게 보여준 배송비(등급별 우대할인
  // 반영된 최종값)를 그대로 받아 orders.final_amount에 합산 — 실결제 금액과 장바구니 총액
  // 불일치 해소(toss_payments_pg_integration_2026-08-30.md F1 후속 지적).
  const deliveryFee = Number.isFinite(body.deliveryFee) && body.deliveryFee > 0 ? Math.floor(body.deliveryFee) : 0

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 구독 "혜택관리" 무료배송(FREE_SHIPPING) — 판정(preview)과 소진(consume) 분리(Migration 554,
  // 2026-09-27). 실제 토스 청구금액은 계약서명 화면에서 이 hold 신청 시점에 기록되는
  // orders.final_amount를 기준으로 결정되므로, "0원 적용 여부"는 반드시 여기서 미리 반영해야
  // 한다(그래야 실결제 고객도 청구액에 혜택이 반영됨) — 다만 월 사용횟수는 아직 소진하지
  // 않는다(p_consume:false). 실제 소진은 결제가 진짜로 확정되는 시점(pay-mock·pay-result)에서만
  // 일어난다 — 그래야 결제·계약서명 전에 취소·방치된 예약이 월 한도를 낭비시키지 않는다.
  // fail-soft — 혜택 판정 실패가 주문 생성 자체를 막지 않는다.
  let finalDeliveryFee = deliveryFee
  if (finalDeliveryFee > 0) {
    try {
      const { data: shippingResult } = await admin.rpc('apply_subscription_free_shipping', {
        p_user_id: session.user.id,
        p_reservation_ids: reservationIds,
        p_consume: false,
      })
      if ((shippingResult as { applies?: boolean } | null)?.applies) {
        finalDeliveryFee = 0
      }
    } catch (err) {
      console.error('[reservations/create-order] apply_subscription_free_shipping(preview) 실패:', err)
    }
  }

  type CreateReservationOrderRpcFn = (
    name: 'create_reservation_order',
    args: {
      p_user_id: string
      p_reservation_ids: number[]
      p_selected_coupon_id: string | null
      p_selected_points: number
      p_delivery_fee: number
    }
  ) => Promise<{ data: { order_id: number; order_key: string; final_amount: number }[] | null; error: unknown }>
  const { data, error } = await (admin.rpc as unknown as CreateReservationOrderRpcFn)(
    'create_reservation_order',
    {
      p_user_id: session.user.id,
      p_reservation_ids: reservationIds,
      p_selected_coupon_id: selectedCouponId,
      p_selected_points: selectedPoints,
      p_delivery_fee: finalDeliveryFee,
    }
  )

  if (error) {
    console.error('[reservations/create-order] create_reservation_order 실패:', error)
    return json({ error: '주문 연결 생성 실패' }, { status: 500 })
  }

  const order = data?.[0] ?? null

  // 3-2: 신규 예약 관리자 푸시 복구 (fail-soft — 실패해도 예약 신청 결과에 영향 없음)
  try {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', session.user.id)
      .maybeSingle()
    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'
    await sendPushToAdmins('new_reservation', {
      title: '새 예약 신청이 들어왔어요',
      body: `${customerName}님이 ${reservationIds.length}건 예약 신청을 했어요.`,
      link: '/cms/reservation',
    })
  } catch {
    // 관리자 푸시 실패는 무시
  }

  return json({ orderId: order?.order_id ?? null, orderKey: order?.order_key ?? null })
}
