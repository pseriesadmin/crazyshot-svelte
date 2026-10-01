/**
 * directPay.ts — 판매전용 "단독" 주문 직접결제(PG) 공용 서버 헬퍼 (2026-10-01, Stephen 확정)
 *
 * 범위: 판매전용 상품만 담은 주문(대여 상품이 하나라도 섞이면 대상 아님)을 장바구니 하단에서 곧바로 Toss 결제창으로 연결하는
 * 새 흐름 전용(장바구니 직접결제 → /api/checkout/pay-start → Toss → /checkout/pay/[orderId]/result, 0원은 /api/checkout/pay-free). 대여+판매 혼합 주문의 "전자계약 서명 → 결제" 흐름
 * (contract/[token]/pay-result·api/contracts/[token]/pay-mock)은 이 파일을 쓰지 않고 그대로 유지한다 — 의도적으로 분리해
 * 기존 결제 경로에 영향이 없게 했다. 결제 후 처리(알림·쿠폰·포인트 소진)는 pay-result와 같은 순서·같은 공용 함수를 쓴다.
 *
 * 확정 규칙: 판매전용은 결제 확인만으로 서명 없이 confirmed가 된다(try_confirm_reservation의 sale_only 분기).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPaymentCompletedAdminPush } from '$lib/server/push'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import { consumeSelectedCoupons } from '$lib/server/coupons/consumeCoupons'
import { calcVatForCart } from '$lib/utils/cartCouponPoints'

/** 직접결제 마감(분) — 결제창 이탈 시 미결제 hold가 이 시간 뒤 자동 만료(Migration 613) */
export const DIRECT_PAY_WINDOW_MINUTES = 30
/**
 * 결제창을 열 때 최소로 남아 있어야 하는 시간(분) — 결제창에서 시간이 걸리는 동안 자동 만료 cron이 먼저 돌아
 * "카드는 청구됐는데 주문은 만료"되는 경합을 막는 여유(sp3 검수 MEDIUM). 이보다 적게 남으면 결제창을 열지 않는다.
 */
export const DIRECT_PAY_MIN_REMAINING_MINUTES = 10

/** 마감까지 결제창을 열기에 충분한 시간이 남았는지 */
export function hasEnoughPayTime(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() - now >= DIRECT_PAY_MIN_REMAINING_MINUTES * 60_000
}

export type DirectPayFailCode =
  | 'ORDER_NOT_FOUND'
  | 'NOT_OWNER'
  | 'NOT_DIRECT_PAY'    // 대여 상품이 섞였거나 구매 건이 아님 → 계약서명 결제 흐름 대상
  | 'ALREADY_PAID'      // 이미 결제·확정됨
  | 'NOT_ACTIVE'        // 취소·만료 등으로 더 이상 결제할 수 없음

export interface DirectPayOrder {
  orderId: number
  finalAmount: number
  selectedPoints: number
  couponDiscount: number
  expiresAt: string | null
  /** order_items 순서와 무관하게 오름차순 정렬 */
  reservationIds: number[]
  /** 대표 예약(알림·결제 행 연결 기준) */
  primaryReservationId: number
  /** 이 주문에 선택된 사용자 쿠폰(user_coupons.id) */
  userCouponIds: string[]
  /** 결제창 주문명용 상품명 목록 */
  productNames: string[]
}

export type LoadDirectPayResult =
  | { ok: true; order: DirectPayOrder }
  | { ok: false; code: DirectPayFailCode }

interface ReservationRow {
  id: number
  user_id: string | null
  status: string
  duration_type: string | null
  product_id: string | null
}

/**
 * 주문을 직접결제 대상으로 검증해 불러온다. 소유자 확인·판매전용 단독 확인·결제 가능 상태 확인을 한 곳에서 처리한다.
 * 결제 금액은 항상 여기서 읽은 orders.final_amount(서버 저장값)만 쓴다 — 화면이 보낸 금액은 신뢰하지 않는다.
 */
export async function loadDirectPayOrder(
  admin: SupabaseClient,
  orderId: number,
  userId: string,
): Promise<LoadDirectPayResult> {
  if (!Number.isFinite(orderId) || orderId <= 0) return { ok: false, code: 'ORDER_NOT_FOUND' }

  const { data: orderRow } = await admin
    .from('orders')
    .select('id, user_id, final_amount, coupon_discount_amount, selected_points, direct_pay_expires_at')
    .eq('id', orderId)
    .maybeSingle()
  const order = orderRow as {
    id: number
    user_id: string | null
    final_amount: number | null
    coupon_discount_amount: number | null
    selected_points: number | null
    direct_pay_expires_at: string | null
  } | null
  if (!order) return { ok: false, code: 'ORDER_NOT_FOUND' }
  if (order.user_id !== userId) return { ok: false, code: 'NOT_OWNER' }

  const { data: itemRows } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', orderId)
  const reservationIds = ((itemRows ?? []) as { reservation_id: number | null }[])
    .map((r) => r.reservation_id)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  if (reservationIds.length === 0) return { ok: false, code: 'ORDER_NOT_FOUND' }

  const { data: resRows } = await admin
    .from('rental_reservations')
    .select('id, user_id, status, duration_type, product_id')
    .in('id', reservationIds)
  const reservations = (resRows ?? []) as ReservationRow[]
  if (reservations.length !== reservationIds.length) return { ok: false, code: 'ORDER_NOT_FOUND' }
  if (reservations.some((r) => r.user_id !== userId)) return { ok: false, code: 'NOT_OWNER' }

  // 판매전용 판별: 예약의 duration_type='purchase' 또는 상품이 판매전용(자식은 부모 값 우선) — products.md §2-15 "두 신호만 사용"
  const productIds = [...new Set(reservations.map((r) => r.product_id).filter((v): v is string => !!v))]
  const { data: prodRows } = await admin
    .from('products')
    .select('id, name, sale_only, parent_product_id')
    .in('id', productIds)
  const products = (prodRows ?? []) as { id: string; name: string; sale_only: boolean | null; parent_product_id: string | null }[]
  const parentIds = [...new Set(products.map((p) => p.parent_product_id).filter((v): v is string => !!v))]
  const parentMap = new Map<string, { sale_only: boolean | null; name: string }>()
  if (parentIds.length > 0) {
    const { data: parentRows } = await admin.from('products').select('id, name, sale_only').in('id', parentIds)
    for (const p of (parentRows ?? []) as { id: string; name: string; sale_only: boolean | null }[]) parentMap.set(p.id, p)
  }
  const productMap = new Map(products.map((p) => [p.id, p]))
  const isSaleLine = (r: ReservationRow): boolean => {
    if (r.duration_type === 'purchase') return true
    const p = r.product_id ? productMap.get(r.product_id) : undefined
    if (!p) return false
    const parent = p.parent_product_id ? parentMap.get(p.parent_product_id) : undefined
    return Boolean(parent?.sale_only ?? p.sale_only)
  }
  if (!reservations.every(isSaleLine)) return { ok: false, code: 'NOT_DIRECT_PAY' }

  if (reservations.every((r) => r.status === 'confirmed')) return { ok: false, code: 'ALREADY_PAID' }
  if (!reservations.every((r) => r.status === 'hold')) return { ok: false, code: 'NOT_ACTIVE' }

  const { data: couponRows } = await admin.from('order_coupons').select('user_coupon_id').eq('order_id', orderId)
  const userCouponIds = ((couponRows ?? []) as { user_coupon_id: string | null }[])
    .map((c) => c.user_coupon_id)
    .filter((v): v is string => !!v)

  const productNames = reservations.map((r) => {
    const p = r.product_id ? productMap.get(r.product_id) : undefined
    const parent = p?.parent_product_id ? parentMap.get(p.parent_product_id) : undefined
    return parent?.name ?? p?.name ?? '상품'
  })

  return {
    ok: true,
    order: {
      orderId,
      finalAmount: Math.max(0, Number(order.final_amount ?? 0)),
      selectedPoints: Math.max(0, Number(order.selected_points ?? 0)),
      couponDiscount: Math.max(0, Number(order.coupon_discount_amount ?? 0)),
      expiresAt: order.direct_pay_expires_at,
      reservationIds,
      primaryReservationId: reservationIds[0],
      userCouponIds,
      productNames,
    },
  }
}

/**
 * 직접결제 마감 시각을 처음 한 번만 설정한다(이미 있으면 유지 — 페이지를 다시 열어도 연장되지 않는다).
 * 반환: 확정된 마감 시각(ISO).
 */
export async function ensureDirectPayDeadline(
  admin: SupabaseClient,
  orderId: number,
  current: string | null,
): Promise<string> {
  if (current) return current
  const deadline = new Date(Date.now() + DIRECT_PAY_WINDOW_MINUTES * 60_000).toISOString()
  // 동시 요청에도 먼저 쓴 값이 이기도록 NULL일 때만 갱신
  await admin.from('orders').update({ direct_pay_expires_at: deadline }).eq('id', orderId).is('direct_pay_expires_at', null)
  const { data } = await admin.from('orders').select('direct_pay_expires_at').eq('id', orderId).maybeSingle()
  return (data as { direct_pay_expires_at: string | null } | null)?.direct_pay_expires_at ?? deadline
}

/**
 * 결제(또는 0원 확정) 직후의 후처리 — contract/[token]/pay-result와 같은 순서:
 * 관리자 결제완료 푸시 → (실제로 confirmed가 된 경우) 승인 알림 → 구독 무료배송 소진 → 쿠폰 소진 → 포인트 소진.
 * 모든 단계는 결제 확정과 독립(fail-soft) — 이미 돈이 청구된 뒤라 실패해도 롤백하지 않는다.
 */
export async function finalizeDirectPayment(
  admin: SupabaseClient,
  params: { userId: string; order: DirectPayOrder; paidAmount: number },
): Promise<{ couponError: string | null }> {
  const { userId, order, paidAmount } = params
  let couponError: string | null = null

  try {
    await sendPaymentCompletedAdminPush(admin, order.primaryReservationId, userId, paidAmount)
  } catch (err) {
    console.error('[directPay] 관리자 결제완료 푸시 실패(fail-soft):', err instanceof Error ? err.message : err)
  }

  try {
    // 판매전용은 결제 확인만으로 confirmed — 실제 전환 여부를 다시 읽어 확인한 뒤에만 승인 알림 발송(pay-result와 동일)
    const { data: confirmedCheck } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', order.primaryReservationId)
      .maybeSingle()
    if ((confirmedCheck as { status: string } | null)?.status === 'confirmed') {
      const plan = await resolveApprovalNotifyPlan(admin, order.primaryReservationId)
      await sendApprovalNotifications(admin, order.primaryReservationId, plan)
    }
  } catch (err) {
    console.error('[directPay] 승인 알림 실패(fail-soft):', err instanceof Error ? err.message : err)
  }

  try {
    const { error } = await admin.rpc('apply_subscription_free_shipping', {
      p_user_id: userId,
      p_reservation_ids: order.reservationIds,
      p_consume: true,
    })
    if (error) console.error('[directPay] apply_subscription_free_shipping(consume) 실패:', error)
  } catch { /* 무료배송 소진 실패도 결제 성공과 독립 */ }

  if (order.userCouponIds.length > 0) {
    try {
      const result = await consumeSelectedCoupons(admin, userId, order.orderId, order.userCouponIds)
      couponError = result.couponError
      if (couponError) console.error('[directPay] use_coupons 거부:', couponError)
    } catch { /* 쿠폰 실패는 결제 성공과 독립 */ }
  }

  if (order.selectedPoints > 0) {
    try {
      await admin.rpc('use_points', { p_user_id: userId, p_points: order.selectedPoints, p_order_id: order.orderId })
    } catch { /* 포인트 실패도 독립 처리 */ }
  }

  return { couponError }
}


/**
 * 결제(또는 0원 확정) 완료 후 보여줄 기존 "예약신청 완료" 화면(/payment/success/dev)용 쿼리 문자열을 서버에서 조립한다.
 * 장바구니가 화면에 보여준 값과 같은 항목·같은 계산(부가세 안내 포함)을 서버 저장값(orders·예약·옵션)으로 재구성 — paid=1로 결제 완료 문구 표시.
 */
export async function buildPaidSuccessQuery(
  admin: SupabaseClient,
  order: DirectPayOrder,
  paymentMethod: string | null,
): Promise<string> {
  const { data: orderRow } = await admin
    .from('orders')
    .select('total_amount, discount_amount, coupon_discount_amount, delivery_fee, selected_points, final_amount')
    .eq('id', order.orderId)
    .maybeSingle()
  const o = (orderRow ?? {}) as Record<string, number | null>
  const total = Number(o.total_amount ?? 0)
  const membership = Number(o.discount_amount ?? 0)
  const coupon = Number(o.coupon_discount_amount ?? 0)
  const points = Number(o.selected_points ?? 0)

  const { data: resRows } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, pickup_method, product_id')
    .in('id', order.reservationIds)
  const reservations = (resRows ?? []) as { id: number; reservation_code: string | null; pickup_method: string | null; product_id: string | null }[]

  const { data: methodRows } = await admin.from('rental_method_options').select('method_key, name')
  const methodName = new Map(((methodRows ?? []) as { method_key: string; name: string }[]).map((m) => [m.method_key, m.name]))

  const { data: itemRows } = await admin.from('order_items').select('reservation_id, line_total, unit_price').eq('order_id', order.orderId)
  const itemMap = new Map(((itemRows ?? []) as { reservation_id: number; line_total: number | null; unit_price: number | null }[]).map((r) => [r.reservation_id, r]))

  const { data: optRows } = await admin.from('reservation_options').select('reservation_id, option_name, qty, unit_price').in('reservation_id', order.reservationIds)
  const optsByRes = new Map<number, { name: string; qty: number; price: number }[]>()
  for (const r of (optRows ?? []) as { reservation_id: number; option_name: string | null; qty: number; unit_price: number | null }[]) {
    const list = optsByRes.get(r.reservation_id) ?? []
    list.push({ name: r.option_name ?? '옵션', qty: r.qty, price: Number(r.unit_price ?? 0) * r.qty })
    optsByRes.set(r.reservation_id, list)
  }

  const items = reservations.map((r, i) => ({
    name: order.productNames[i] ?? '상품',
    code: r.reservation_code ?? '',
    startDate: '',
    endDate: '',
    pickupMethod: r.pickup_method ? (methodName.get(r.pickup_method) ?? r.pickup_method) : '',
    returnMethod: '',
    price: Number(itemMap.get(r.id)?.unit_price ?? 0),
    options: optsByRes.get(r.id) ?? [],
  }))

  const d = new Date(Date.now() + 9 * 3600_000) // KST
  const pad = (n: number) => String(n).padStart(2, '0')
  const confirmedAt = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}·${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`

  return new URLSearchParams({
    items: JSON.stringify(items),
    amount: String(order.finalAmount),
    subtotal: String(total),
    membershipDiscount: String(membership),
    couponDiscount: String(coupon),
    deliveryFee: String(Number(o.delivery_fee ?? 0)),
    holidayExtraFee: '0',
    vat: String(calcVatForCart(Math.max(0, total - membership - coupon), points)),
    pointsUsed: String(points),
    confirmedAt,
    paymentMethod: paymentMethod ?? (order.finalAmount === 0 ? '쿠폰·포인트' : '카드'),
    paid: '1',
  }).toString()
}
