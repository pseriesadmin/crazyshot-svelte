import { describe, it, expect } from 'vitest'
import { calcStackedCouponDiscount, canAddCoupon, type StackableCoupon } from '$lib/utils/couponStacking'
import { checkCouponOrderConditions, couponConditionMessage } from '$lib/utils/couponOrderConditions'

const c = (over: Partial<StackableCoupon> & { id: string }): StackableCoupon => ({
  coupon_id: over.id, discount_type: 'fixed', discount_value: 0, max_discount_amount: null, allow_coupon_stacking: true, ...over,
})

describe('쿠폰 다중 선택 할인 계산 — 서버 apply_order_coupon_discounts(Migration 621)와 동일', () => {
  it('Stage 라이브 검증값: 정액 3,000원 + 정률 10% → 상품 50,000원에서 7,700원', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'a', discount_type: 'fixed', discount_value: 3000 }),
      c({ id: 'b', discount_type: 'percentage', discount_value: 10 }),
    ], 50000, 0)
    expect(r.fixed).toBe(3000)
    expect(r.percentage).toBe(4700) // (50,000 − 3,000) × 10%
    expect(r.total).toBe(7700)
  })
  it('정률 쿠폰 2장은 같은 기준에 율을 합산한다(순차 복리 아님)', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'z', coupon_id: 'z', discount_type: 'percentage', discount_value: 50 }),
      c({ id: 'a', coupon_id: 'a', discount_type: 'percentage', discount_value: 10 }),
    ], 100000, 0)
    // 10% + 50% = 60% → 60,000 (복리였다면 55,000)
    expect(r.percentage).toBe(60000)
  })
  it('1일차 한정 쿠폰: 미친할인 30%(주문) + 방문 10%(1일차), 2일 대여(1일차 25,000/총 50,000) → 15,000 + 2,500', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'c30', coupon_id: 'a', discount_type: 'percentage', discount_value: 30 }),
      c({ id: 'c10', coupon_id: 'b', discount_type: 'percentage', discount_value: 10, discount_scope: 'first_day' }),
    ], 50000, 0, 25000)
    expect(r.byCoupon).toEqual({ c30: 15000, c10: 2500 })
    expect(r.percentage).toBe(17500)
  })
  it('정액 + 1일차 한정: 기준은 정액 차감 후 잔액 중 1일차 몫(R1 = B1×R/T)', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'f', discount_type: 'fixed', discount_value: 10000 }),
      c({ id: 'p', coupon_id: 'p', discount_type: 'percentage', discount_value: 10, discount_scope: 'first_day' }),
    ], 50000, 0, 25000)
    // R=40,000, R1=20,000 → 2,000
    expect(r.byCoupon.p).toBe(2000)
  })
  it('합계가 잔액을 넘지 않는다: 60% + 60% → 잔액 100,000까지만', () => {
    const r = calcStackedCouponDiscount([
      c({ id: 'a', coupon_id: 'a', discount_type: 'percentage', discount_value: 60 }),
      c({ id: 'b', coupon_id: 'b', discount_type: 'percentage', discount_value: 60 }),
    ], 100000, 0)
    expect(r.byCoupon).toEqual({ a: 60000, b: 40000 })
    expect(r.total).toBe(100000)
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
