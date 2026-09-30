/**
 * 쿠폰 "주문 의존" 사용 조건 판정 — 클라이언트(장바구니)·서버 공용 순수 함수.
 *
 * 서버의 isCouponEligible(couponEligibility.ts)·DB 소진 규칙(private._validate_and_consume_coupon)의
 * 주문 의존 부분과 같은 규칙이다(최소 금액·최소 대여일·방문 전용). 장바구니는 주문이 아직 없어서
 * 서버가 로드 시점에 이 조건을 판정할 수 없었으므로(B-1), 화면이 현재 선택 상태로 직접 판정한다.
 */

export interface CouponOrderConditionFields {
  min_purchase_amount: number
  min_rental_amount: number
  min_rental_days: number
  is_walk_in_only: boolean
}

export interface CouponOrderContext {
  /** 주문(장바구니) 상품 합계 — 아직 계산 전이면 null */
  orderAmount: number | null
  /** 담긴 대여 예약 중 최소 대여일수(박 수, DB rental_days와 같은 기준) */
  minRentalDays: number | null
  /** 모든 대여 예약이 방문 수령 */
  allWalkIn: boolean | null
}

export type CouponOrderReason =
  | 'ORDER_CONTEXT_REQUIRED'
  | 'MIN_AMOUNT_NOT_MET'
  | 'MIN_DAYS_NOT_MET'
  | 'WALK_IN_ONLY'

export function hasOrderCondition(c: CouponOrderConditionFields): boolean {
  return c.min_purchase_amount > 0 || c.min_rental_amount > 0 || c.min_rental_days > 0 || c.is_walk_in_only
}

export function checkCouponOrderConditions(
  c: CouponOrderConditionFields,
  ctx: CouponOrderContext,
): { ok: true } | { ok: false; reason: CouponOrderReason } {
  if (!hasOrderCondition(c)) return { ok: true }
  if (ctx.orderAmount === null) return { ok: false, reason: 'ORDER_CONTEXT_REQUIRED' }
  if (c.min_purchase_amount > 0 && ctx.orderAmount < c.min_purchase_amount) return { ok: false, reason: 'MIN_AMOUNT_NOT_MET' }
  if (c.min_rental_amount > 0 && ctx.orderAmount < c.min_rental_amount) return { ok: false, reason: 'MIN_AMOUNT_NOT_MET' }
  if (c.min_rental_days > 0 && (ctx.minRentalDays === null || ctx.minRentalDays < c.min_rental_days)) {
    return { ok: false, reason: 'MIN_DAYS_NOT_MET' }
  }
  if (c.is_walk_in_only && !ctx.allWalkIn) return { ok: false, reason: 'WALK_IN_ONLY' }
  return { ok: true }
}

/** 미충족 사유를 고객이 이해할 수 있는 한 줄로 */
export function couponConditionMessage(reason: CouponOrderReason, c: CouponOrderConditionFields): string {
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  switch (reason) {
    case 'ORDER_CONTEXT_REQUIRED': return '대여 정보를 입력하면 확인돼요'
    case 'MIN_AMOUNT_NOT_MET': return `최소 대여금액 ${won(Math.max(c.min_purchase_amount, c.min_rental_amount))} 이상`
    case 'MIN_DAYS_NOT_MET': return `최소 대여기간 ${c.min_rental_days}일 이상`
    default: return '방문 수령 시 사용 가능'
  }
}
