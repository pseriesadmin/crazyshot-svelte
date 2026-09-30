import { describe, it, expect } from 'vitest'
import { calcStackedCouponDiscount, canAddCoupon, type StackableCoupon } from '$lib/utils/couponStacking'
import { checkCouponOrderConditions, couponConditionMessage } from '$lib/utils/couponOrderConditions'

const c = (over: Partial<StackableCoupon> & { id: string }): StackableCoupon => ({
  coupon_id: over.id, discount_type: 'fixed', discount_value: 0, max_discount_amount: null, allow_coupon_stacking: true, ...over,
})

describe('쿠폰 다중 선택 할인 계산 — 서버 sync 산식과 동일 (B-2)', () => {
  it('Stage 라이브 검증값: 정액 3,000원 + 정률 10% → 상품 50,000원에서 7,700원', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'a', discount_type: 'fixed', discount_value: 3000 }),
      c({ id: 'b', discount_type: 'percentage', discount_value: 10 }),
    ], 50000, 0)
    expect(r.fixed).toBe(3000)
    expect(r.percentage).toBe(4700) // (50,000 − 3,000) × 10%
    expect(r.total).toBe(7700)
  })
  it('정률 쿠폰 2장은 coupon_id 오름차순 순차 적용(잔액 감쇠)', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'z', coupon_id: 'z', discount_type: 'percentage', discount_value: 50 }),
      c({ id: 'a', coupon_id: 'a', discount_type: 'percentage', discount_value: 10 }),
    ], 100000, 0)
    // a(10%) → 10,000, 잔액 90,000 → z(50%) → 45,000
    expect(r.percentage).toBe(55000)
  })
  it('최대 할인 한도는 단계별로 적용', () => {
    const r = calcStackedCouponDiscount([c({ id: 'a', discount_type: 'percentage', discount_value: 30, max_discount_amount: 5000 })], 100000, 0)
    expect(r.total).toBe(5000)
  })
  it('무료배송은 합계와 무관하게 배송비를 넘지 못한다(2장이어도 배송비 한도)', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'a', discount_type: 'free_shipping', discount_value: 6600 }),
      c({ id: 'b', discount_type: 'free_shipping', discount_value: 6600 }),
    ], 50000, 8000)
    expect(r.freeShipping).toBe(8000)
  })
  it('정액이 상품 합계를 넘어도 정률은 0 기준(음수 금지)', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'a', discount_type: 'fixed', discount_value: 90000 }),
      c({ id: 'b', discount_type: 'percentage', discount_value: 10 }),
    ], 50000, 0)
    expect(r.percentage).toBe(0)
  })
})

describe('쿠폰끼리 중복 허용 판정 (B-2)', () => {
  it('아무것도 선택 안 했으면 중복 불가 쿠폰도 선택 가능', () => {
    expect(canAddCoupon([], { allow_coupon_stacking: false })).toBe(true)
  })
  it('둘 다 허용이면 함께 선택 가능', () => {
    expect(canAddCoupon([{ allow_coupon_stacking: true }], { allow_coupon_stacking: true })).toBe(true)
  })
  it('새 쿠폰이 중복 불가이거나 기존 선택 중 중복 불가가 있으면 섞을 수 없다', () => {
    expect(canAddCoupon([{ allow_coupon_stacking: true }], { allow_coupon_stacking: false })).toBe(false)
    expect(canAddCoupon([{ allow_coupon_stacking: false }], { allow_coupon_stacking: true })).toBe(false)
  })
})

describe('쿠폰 주문 의존 조건 판정 — 장바구니 클라이언트용 (B-1)', () => {
  const base = { min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0, is_walk_in_only: false }
  it('조건이 없으면 대여 정보 없이도 통과', () => {
    expect(checkCouponOrderConditions(base, { orderAmount: null, minRentalDays: null, allWalkIn: null }).ok).toBe(true)
  })
  it('신고 시나리오: 최소 10만원·3일·방문 전용 조건을 492,000원·4일·방문으로 채우면 통과', () => {
    const coupon = { min_purchase_amount: 0, min_rental_amount: 100000, min_rental_days: 3, is_walk_in_only: true }
    expect(checkCouponOrderConditions(coupon, { orderAmount: 492000, minRentalDays: 4, allWalkIn: true }).ok).toBe(true)
  })
  it('미충족 사유별 판정과 고객용 문구', () => {
    const coupon = { min_purchase_amount: 0, min_rental_amount: 100000, min_rental_days: 3, is_walk_in_only: true }
    const r1 = checkCouponOrderConditions(coupon, { orderAmount: 50000, minRentalDays: 4, allWalkIn: true })
    expect(r1).toEqual({ ok: false, reason: 'MIN_AMOUNT_NOT_MET' })
    expect(couponConditionMessage('MIN_AMOUNT_NOT_MET', coupon)).toBe('최소 대여금액 100,000원 이상')
    expect(checkCouponOrderConditions(coupon, { orderAmount: 200000, minRentalDays: 2, allWalkIn: true })).toEqual({ ok: false, reason: 'MIN_DAYS_NOT_MET' })
    expect(couponConditionMessage('MIN_DAYS_NOT_MET', coupon)).toBe('최소 대여기간 3일 이상')
    expect(checkCouponOrderConditions(coupon, { orderAmount: 200000, minRentalDays: 4, allWalkIn: false })).toEqual({ ok: false, reason: 'WALK_IN_ONLY' })
    expect(couponConditionMessage('WALK_IN_ONLY', coupon)).toBe('방문 수령 시 사용 가능')
  })
  it('주문 정보가 아직 없으면(대여 정보 미입력) 사유를 안내', () => {
    const coupon = { ...base, min_rental_amount: 1000 }
    expect(checkCouponOrderConditions(coupon, { orderAmount: null, minRentalDays: null, allWalkIn: null })).toEqual({ ok: false, reason: 'ORDER_CONTEXT_REQUIRED' })
  })
})
