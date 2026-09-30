/**
 * 쿠폰 다중 선택 — 할인 계산·중복 허용 판정 (장바구니 화면·서버 공용 순수 함수).
 *
 * 서버 정본: sync_order_after_composition_change / create_reservation_order (Migration 533·534).
 * 순차 할인 산식:
 *   F  = Σ(fixed 쿠폰 discount_value)
 *   R  = max(상품합계 − F, 0)
 *   percentage 쿠폰은 coupon_id 오름차순으로 순차 적용: step = min(round(R × rate/100), max_discount_amount), R −= step
 *   FS = min(Σ free_shipping discount_value, 배송비)  — 배송비에만 적용
 *   쿠폰 할인 합계 = F + Σstep + FS
 */

export interface StackableCoupon {
  /** user_coupons.id */
  id: string
  /** coupons.id — 정률 쿠폰 적용 순서(오름차순)에 사용 */
  coupon_id: string
  discount_type: string
  discount_value: number
  max_discount_amount: number | null
  /** 쿠폰끼리 중복 허용(coupons.allow_coupon_stacking) */
  allow_coupon_stacking: boolean
}

export interface StackedDiscount {
  fixed: number
  percentage: number
  freeShipping: number
  total: number
}

export function calcStackedCouponDiscount(
  selected: StackableCoupon[],
  subtotal: number,
  deliveryFee: number,
): StackedDiscount {
  const fixed = selected
    .filter((c) => c.discount_type === 'fixed')
    .reduce((sum, c) => sum + c.discount_value, 0)

  const freeShippingRaw = selected
    .filter((c) => c.discount_type === 'free_shipping')
    .reduce((sum, c) => sum + c.discount_value, 0)

  const percentageCoupons = selected
    .filter((c) => c.discount_type === 'percentage')
    .slice()
    .sort((a, b) => (a.coupon_id < b.coupon_id ? -1 : a.coupon_id > b.coupon_id ? 1 : 0))

  let running = Math.max(subtotal - fixed, 0)
  let percentage = 0
  for (const c of percentageCoupons) {
    let step = Math.round((running * c.discount_value) / 100)
    if (c.max_discount_amount && c.max_discount_amount > 0) step = Math.min(step, c.max_discount_amount)
    percentage += step
    running = Math.max(running - step, 0)
  }

  const freeShipping = Math.min(freeShippingRaw, Math.max(deliveryFee, 0))
  return { fixed, percentage, freeShipping, total: fixed + percentage + freeShipping }
}

/**
 * 쿠폰을 추가 선택할 수 있는지 — 이미 선택된 쿠폰이 있을 때 "쿠폰끼리 중복 허용"이 꺼진 쿠폰이
 * 기존 선택이나 새 쿠폰 어느 쪽에라도 있으면 함께 쓸 수 없다. 선택이 비어 있으면 항상 가능.
 */
export function canAddCoupon(selected: Array<{ allow_coupon_stacking: boolean }>, candidate: { allow_coupon_stacking: boolean }): boolean {
  if (selected.length === 0) return true
  return candidate.allow_coupon_stacking && selected.every((c) => c.allow_coupon_stacking)
}
