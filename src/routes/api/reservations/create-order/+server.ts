import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
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

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  type CreateReservationOrderRpcFn = (
    name: 'create_reservation_order',
    args: {
      p_user_id: string
      p_reservation_ids: number[]
      p_selected_coupon_id: string | null
      p_selected_points: number
    }
  ) => Promise<{ data: { order_id: number; order_key: string; final_amount: number }[] | null; error: unknown }>
  const { data, error } = await (admin.rpc as unknown as CreateReservationOrderRpcFn)(
    'create_reservation_order',
    {
      p_user_id: session.user.id,
      p_reservation_ids: reservationIds,
      p_selected_coupon_id: selectedCouponId,
      p_selected_points: selectedPoints,
    }
  )

  if (error) {
    console.error('[reservations/create-order] create_reservation_order 실패:', error)
    return json({ error: '주문 연결 생성 실패' }, { status: 500 })
  }

  const order = data?.[0] ?? null
  return json({ orderId: order?.order_id ?? null, orderKey: order?.order_key ?? null })
}
