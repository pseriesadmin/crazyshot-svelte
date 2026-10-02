/**
 * 쿠폰 다중 선택 — 할인 계산·중복 허용 판정 (장바구니 화면·서버 공용 순수 함수).
 *
 * 서버 정본: apply_order_coupon_discounts (Migration 621) — create_reservation_order /
 * sync_order_after_composition_change 가 모두 이 함수 하나를 호출한다.
 * 정률 "합산" 산식 (2026-10-02, Stephen 확정 — 순차 복리 아님):
 *   F  = Σ(fixed 쿠폰 discount_value)
 *   R  = max(상품합계 − F, 0)
 *   정률 쿠폰은 같은 기준 금액에 율을 합산해 적용한다 (각 쿠폰 = 기준 × 율):
 *     discount_scope='order'     → 기준 R
 *     discount_scope='first_day' → 기준 R1 = B1 × R / T  (B1 = 1일차 요금, T = 상품합계)
 *     step = min(round(기준 × rate/100), max_discount_amount)
 *   합계가 R을 넘지 않도록 coupon_id 오름차순으로 잘라낸다.
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
  /** 할인 적용 범위(coupons.discount_scope) — 없으면 'order' */
  discount_scope?: 'order' | 'first_day'
}

export interface StackedDiscount {
  fixed: number
  percentage: number
  freeShipping: number
  total: number
  /** 쿠폰별 실제 할인액 — 키는 user_coupons.id */
  byCoupon: Record<string, number>
}

export function calcStackedCouponDiscount(
  selected: StackableCoupon[],
  subtotal: number,
  deliveryFee: number,
  /** 1일차 한정 쿠폰의 기준(B1) — 생략하면 상품합계 전체(= 범위 구분 없음) */
  firstDayBase: number = subtotal,
): StackedDiscount {
  const byCoupon: Record<string, number> = {}

  const fixedCoupons = selected.filter((c) => c.discount_type === 'fixed')
  const fixed = fixedCoupons.reduce((sum, c) => sum + c.discount_value, 0)
  for (const c of fixedCoupons) byCoupon[c.id] = c.discount_value

  const fsCoupons = selected.filter((c) => c.discount_type === 'free_shipping')
  const freeShippingRaw = fsCoupons.reduce((sum, c) => sum + c.discount_value, 0)
  for (const c of fsCoupons) byCoupon[c.id] = c.discount_value

  const percentageCoupons = selected
    .filter((c) => c.discount_type === 'percentage')
    .slice()
    .sort((a, b) => (a.coupon_id < b.coupon_id ? -1 : a.coupon_id > b.coupon_id ? 1 : 0))

  const remainder = Math.max(subtotal - fixed, 0)
  const b1 = Math.min(Math.max(firstDayBase, 0), subtotal)
  let remaining = remainder
  let percentage = 0
  for (const c of percentageCoupons) {
    let step: number
    if (c.discount_scope === 'first_day') {
      step = subtotal > 0 ? Math.round((b1 * remainder * c.discount_value) / (subtotal * 100)) : 0
    } else {
      step = Math.round((remainder * c.discount_value) / 100)
    }
    if (c.max_discount_amount && c.max_discount_amount > 0) step = Math.min(step, c.max_discount_amount)
    step = Math.min(step, remaining)
    remaining -= step
    percentage += step
    byCoupon[c.id] = step
  }

  const freeShipping = Math.min(freeShippingRaw, Math.max(deliveryFee, 0))
  return { fixed, percentage, freeShipping, total: fixed + percentage + freeShipping, byCoupon }
}

/**
 * 쿠폰을 추가 선택할 수 있는지 — 이미 선택된 쿠폰이 있을 때 "쿠폰끼리 중복 허용"이 꺼진 쿠폰이
 * 기존 선택이나 새 쿠폰 어느 쪽에라도 있으면 함께 쓸 수 없다. 선택이 비어 있으면 항상 가능.
 */
export function canAddCoupon(selected: Array<{ allow_coupon_stacking: boolean }>, candidate: { allow_coupon_stacking: boolean }): boolean {
  if (selected.length === 0) return true
  return candidate.allow_coupon_stacking && selected.every((c) => c.allow_coupon_stacking)
}
