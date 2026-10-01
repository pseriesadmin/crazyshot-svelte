import { describe, it, expect } from 'vitest'
import { checkCouponOrderConditions, couponConditionMessage, type CouponOrderConditionFields, type CouponOrderContext } from '$lib/utils/couponOrderConditions'

// 쿠폰 "적용 대상"(applies_to_rental / applies_to_sale) 장바구니 분류 — CMS 쿠폰 설정(Migration 615) 연동
const base: CouponOrderConditionFields = { min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0, is_walk_in_only: false }
const ctx = (over: Partial<CouponOrderContext>): CouponOrderContext => ({ orderAmount: 50000, minRentalDays: 2, allWalkIn: true, hasRentalLine: false, hasSaleLine: false, ...over })

describe('쿠폰 적용 대상 판정', () => {
  it('둘 다 적용(기본값)이면 어떤 구성이든 통과 — 기존 동작 유지', () => {
    const c = { ...base, applies_to_rental: true, applies_to_sale: true }
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true })).ok).toBe(true)
    expect(checkCouponOrderConditions(c, ctx({ hasSaleLine: true })).ok).toBe(true)
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true, hasSaleLine: true })).ok).toBe(true)
  })
  it('필드가 없으면(구 호출부·구 데이터) 둘 다 적용으로 취급', () => {
    expect(checkCouponOrderConditions(base, ctx({ hasSaleLine: true })).ok).toBe(true)
  })
  it('대여 전용 쿠폰: 판매 상품만 담으면 비활성(RENTAL_ONLY_COUPON), 대여가 있으면 활성', () => {
    const c = { ...base, applies_to_rental: true, applies_to_sale: false }
    expect(checkCouponOrderConditions(c, ctx({ hasSaleLine: true }))).toEqual({ ok: false, reason: 'RENTAL_ONLY_COUPON' })
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true })).ok).toBe(true)
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true, hasSaleLine: true })).ok).toBe(true)
  })
  it('판매 전용 쿠폰: 대여 상품만 담으면 비활성(SALE_ONLY_COUPON), 판매가 있으면 활성', () => {
    const c = { ...base, applies_to_rental: false, applies_to_sale: true }
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true }))).toEqual({ ok: false, reason: 'SALE_ONLY_COUPON' })
    expect(checkCouponOrderConditions(c, ctx({ hasSaleLine: true })).ok).toBe(true)
    expect(checkCouponOrderConditions(c, ctx({ hasRentalLine: true, hasSaleLine: true })).ok).toBe(true)
  })
  it('적용 대상 판정은 금액 정보가 아직 없어도(ORDER_CONTEXT_REQUIRED 상태) 먼저 적용된다', () => {
    const c = { ...base, min_purchase_amount: 1000, applies_to_rental: true, applies_to_sale: false }
    expect(checkCouponOrderConditions(c, ctx({ orderAmount: null, hasSaleLine: true }))).toEqual({ ok: false, reason: 'RENTAL_ONLY_COUPON' })
  })
  it('안내 문구', () => {
    expect(couponConditionMessage('RENTAL_ONLY_COUPON', base)).toBe('대여 상품에만 사용 가능')
    expect(couponConditionMessage('SALE_ONLY_COUPON', base)).toBe('판매 상품에만 사용 가능')
  })
})
