/**
 * 주문에 적용된 쿠폰별 할인 계산 단계 — CMS 결제정보 탭 "할인쿠폰 적용" 아코디언 표시용 (2026-10-02)
 *
 * 서버 정본(apply_order_coupon_discounts, Migration 621)과 같은 순서·산식을 따른다(service-operations.md §21):
 *   ① 정액(fixed) 쿠폰 전부를 먼저 합산해 차감 — 잔액 R = max(총액 − Σ정액, 0), 할인액은 액면 그대로 기록
 *   ② 정률(percentage) 쿠폰은 순차 복리가 아니라 같은 기준 금액에 율을 "합산" 적용한다:
 *        주문 전체 쿠폰   → 기준 R
 *        1일차 한정 쿠폰  → 기준 R1 = 1일차 요금 B1 × R / 총액 T  (대여 1일차 몫)
 *      각 쿠폰 할인 = ROUND(기준 × 율)(소수 .5는 올림), 한도(max_discount_amount > 0)가 있으면 LEAST,
 *      합계가 R을 넘지 않도록 coupon_id 오름차순으로 잘라낸다
 *   ③ 무료배송(free_shipping)은 요금이 아니라 배송비 한도 안에서만 차감(여러 장은 배송비를 함께 소진)
 * 화면 표시용 계산일 뿐이며 결제금액의 정본은 항상 orders.final_amount다(이 모듈은 값을 저장·변경하지 않는다).
 */

export interface OrderCouponInput {
  couponId: string
  name: string
  discountType: 'fixed' | 'percentage' | 'free_shipping' | string
  discountValue: number
  maxDiscountAmount: number | null
  /** 할인 적용 범위 — 없으면 'order'(주문 전체), 'first_day'는 대여 1일차 요금 기준(정률 전용) */
  discountScope?: 'order' | 'first_day'
}

export interface CouponBreakdownStep {
  couponId: string
  name: string
  discountType: 'fixed' | 'percentage' | 'free_shipping' | string
  /** "정액 10,000원" / "정률 30% (최대 20,000원)" / "무료배송 (최대 3,000원)" */
  rateLabel: string
  /** 정률 쿠폰의 율(%), 그 외 null */
  rate: number | null
  /** 할인 적용 범위 */
  scope: 'order' | 'first_day'
  /** 할인 기준 금액 — 정액: 직전 대여요금 / 정률(주문 전체): 정액 차감 후 잔액 / 정률(1일차): 잔액 중 1일차 몫 / 무료배송: 배송비 */
  baseAmount: number
  /** 기준 금액의 이름 — "정액 차감 후 대여요금" · "1일차 요금(정액 차감 후)" · "배송비" 등 */
  basisLabel: string
  /** 이 쿠폰의 할인액 */
  discountAmount: number
  /** 이 쿠폰을 적용한 직후 대여요금(정액·정률은 누적 잔액, 무료배송은 배송비 잔액) */
  balanceAfter: number
  /** 정률 쿠폰이 한도(max_discount_amount)로 제한됐는가 */
  capped: boolean
  /** 정률 한도 금액(없으면 null) */
  maxDiscountAmount: number | null
}

export interface CouponBreakdown {
  steps: CouponBreakdownStep[]
  /** 쿠폰 할인 합계(정액 + 정률 + 배송비 차감) — orders.coupon_discount_amount와 같은 정의 */
  totalDiscount: number
  /** 모든 정액·정률 쿠폰 적용 후 대여요금 잔액(무료배송은 영향 없음) */
  finalBalance: number
}

function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

function typeRank(t: string): number {
  if (t === 'fixed') return 0
  if (t === 'percentage') return 1
  if (t === 'free_shipping') return 2
  return 3
}

export function buildCouponBreakdown(
  totalAmount: number,
  coupons: OrderCouponInput[],
  deliveryFee: number,
  /** 1일차 한정 쿠폰의 기준(B1) — 생략하면 총액 전체 */
  firstDayBase?: number,
): CouponBreakdown {
  const ordered = [...coupons].sort((a, b) => {
    const r = typeRank(a.discountType) - typeRank(b.discountType)
    if (r !== 0) return r
    return a.couponId < b.couponId ? -1 : a.couponId > b.couponId ? 1 : 0
  })

  const total = Math.max(totalAmount, 0)
  const b1 = Math.min(Math.max(firstDayBase ?? total, 0), total)
  const fixedSum = ordered.filter(c => c.discountType === 'fixed').reduce((sum, c) => sum + (Number(c.discountValue) || 0), 0)
  const remainder = Math.max(total - fixedSum, 0)

  let balance = total
  let remaining = remainder          // 정률 합산이 넘지 못하는 한도(잔액)
  let shippingLeft = Math.max(deliveryFee, 0)
  let totalDiscount = 0
  const steps: CouponBreakdownStep[] = []

  for (const cp of ordered) {
    const value = Number(cp.discountValue) || 0
    const max = cp.maxDiscountAmount != null && cp.maxDiscountAmount > 0 ? cp.maxDiscountAmount : null
    const scope: 'order' | 'first_day' = cp.discountScope === 'first_day' && cp.discountType === 'percentage' ? 'first_day' : 'order'

    if (cp.discountType === 'fixed') {
      const after = Math.max(balance - value, 0)
      steps.push({
        couponId: cp.couponId, name: cp.name, discountType: cp.discountType,
        rateLabel: `정액 ${won(value)}`, rate: null, scope,
        baseAmount: balance, basisLabel: '대여요금', discountAmount: value, balanceAfter: after, capped: false, maxDiscountAmount: null,
      })
      totalDiscount += value
      balance = after
    } else if (cp.discountType === 'percentage') {
      let basis = remainder
      let basisLabel = '정액 차감 후 대여요금'
      if (scope === 'first_day') {
        basis = total > 0 ? (b1 * remainder) / total : 0
        basisLabel = '1일차 요금(정액 차감 후)'
      }
      let discount = scope === 'first_day'
        ? (total > 0 ? Math.round((b1 * remainder * value) / (total * 100)) : 0)
        : Math.round((remainder * value) / 100)
      let capped = false
      if (max != null && discount > max) { discount = max; capped = true }
      discount = Math.min(discount, remaining)
      remaining -= discount
      const after = Math.max(balance - discount, 0)
      steps.push({
        couponId: cp.couponId, name: cp.name, discountType: cp.discountType,
        rateLabel: max != null ? `정률 ${value}% (최대 ${won(max)})` : `정률 ${value}%`, rate: value, scope,
        baseAmount: Math.round(basis), basisLabel, discountAmount: discount, balanceAfter: after, capped, maxDiscountAmount: max,
      })
      totalDiscount += discount
      balance = after
    } else if (cp.discountType === 'free_shipping') {
      const discount = Math.min(value, shippingLeft)
      steps.push({
        couponId: cp.couponId, name: cp.name, discountType: cp.discountType,
        rateLabel: `무료배송 (최대 ${won(value)})`, rate: null, scope,
        baseAmount: shippingLeft, basisLabel: '배송비', discountAmount: discount, balanceAfter: shippingLeft - discount, capped: false, maxDiscountAmount: null,
      })
      totalDiscount += discount
      shippingLeft -= discount
    } else {
      // 서버는 알 수 없는 종류의 쿠폰을 할인에 반영하지 않는다 — 화면에도 0원 단계로만 남긴다
      steps.push({
        couponId: cp.couponId, name: cp.name, discountType: cp.discountType,
        rateLabel: '기타', rate: null, scope,
        baseAmount: balance, basisLabel: '대여요금', discountAmount: 0, balanceAfter: balance, capped: false, maxDiscountAmount: null,
      })
    }
  }

  return { steps, totalDiscount, finalBalance: balance }
}
