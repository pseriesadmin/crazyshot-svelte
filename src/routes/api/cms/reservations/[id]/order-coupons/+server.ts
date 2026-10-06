import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { buildCouponBreakdown, type OrderCouponInput } from '$lib/utils/orderCouponBreakdown'

// 주문에 적용된 쿠폰 목록 + 쿠폰별 할인 계산 단계 — RentalDetailPanel 결제정보 탭 "할인쿠폰 적용" 아코디언용(2026-10-02).
// 쿠폰별 할인율·금액과 "직전 금액 → 할인액 → 할인 후 금액" 단계를 서버 정본(apply_order_coupon_discounts, Migration 621)과
// 같은 산식(orderCouponBreakdown.ts, Migration 621 정률 합산·1일차 한정)으로 계산해 돌려준다. 값은 조회·표시 전용이며 주문 금액을 변경하지 않는다.
//   - 다중쿠폰 주문(Migration 531~534): order_coupons 행 기준
//   - 구(舊) 단일쿠폰 주문: orders.selected_coupon_id 기준(order_coupons 행이 없을 때만)
// order_id가 없으면(단일 상품·주문 미연결 예약) 빈 목록.
export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: ownItem, error: ownErr } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  if (ownErr) return json({ error: ownErr.message }, { status: 500 })
  if (!ownItem) return json({ orderId: null, steps: [], totalDiscount: 0, storedDiscount: 0, finalBalance: 0, totalAmount: 0, consistent: true })

  const orderId = ownItem.order_id as number

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('total_amount, delivery_fee, coupon_discount_amount, selected_coupon_id')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return json({ error: orderErr.message }, { status: 500 })
  if (!order) return json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  type CouponRow = {
    display_name: string | null
    description: string | null
    code: string | null
    discount_type: string
    discount_value: number | string
    max_discount_amount: number | string | null
    discount_scope: string | null
  }

  const toInput = (couponId: string, c: CouponRow): OrderCouponInput => ({
    couponId,
    name: c.display_name ?? c.description ?? c.code ?? '쿠폰',
    discountType: c.discount_type,
    discountValue: Number(c.discount_value) || 0,
    maxDiscountAmount: c.max_discount_amount != null ? Number(c.max_discount_amount) : null,
    discountScope: c.discount_scope === 'first_day' ? 'first_day' : 'order',
  })

  const { data: ocRows, error: ocErr } = await admin
    .from('order_coupons')
    .select('coupon_id, coupons(display_name, description, code, discount_type, discount_value, max_discount_amount, discount_scope)')
    .eq('order_id', orderId)
  if (ocErr) return json({ error: ocErr.message }, { status: 500 })

  let inputs: OrderCouponInput[] = ((ocRows ?? []) as unknown as Array<{ coupon_id: string; coupons: CouponRow | null }>)
    .filter(r => r.coupons != null)
    .map(r => toInput(r.coupon_id, r.coupons as CouponRow))

  // 구(舊) 단일쿠폰 경로 — 다중쿠폰 전환(Migration 531~534) 이전 주문
  if (inputs.length === 0 && order.selected_coupon_id) {
    const { data: uc } = await admin
      .from('user_coupons')
      .select('coupon_id, coupons(display_name, description, code, discount_type, discount_value, max_discount_amount, discount_scope)')
      .eq('id', order.selected_coupon_id as string)
      .maybeSingle()
    const legacy = uc as unknown as { coupon_id: string; coupons: CouponRow | null } | null
    if (legacy?.coupons) inputs = [toInput(legacy.coupon_id, legacy.coupons)]
  }

  const totalAmount = Number(order.total_amount) || 0
  const deliveryFee = Number(order.delivery_fee) || 0
  const storedDiscount = Number(order.coupon_discount_amount) || 0
  // 1일차 한정 쿠폰의 기준(B1) — 서버 정본과 같은 함수(order_first_day_base, service_role 전용)로 구한다.
  // 1일차 한정 쿠폰이 없으면 호출하지 않는다(불필요한 요금 재계산 방지).
  let firstDayBase = totalAmount
  if (inputs.some(i => i.discountScope === 'first_day')) {
    const { data: fdb, error: fdbErr } = await admin.rpc('order_first_day_base', { p_order_id: orderId })
    if (fdbErr) return json({ error: fdbErr.message }, { status: 500 })
    firstDayBase = Number(fdb) || 0
  }
  const breakdown = buildCouponBreakdown(totalAmount, inputs, deliveryFee, firstDayBase)

  return json({
    orderId,
    totalAmount,
    deliveryFee,
    storedDiscount,
    steps: breakdown.steps,
    totalDiscount: breakdown.totalDiscount,
    finalBalance: breakdown.finalBalance,
    // 화면 계산 합계가 주문에 저장된 쿠폰 할인액과 같은가(다르면 화면이 안내만 표시 — 금액은 저장값이 정본)
    consistent: breakdown.totalDiscount === storedDiscount,
  })
}
