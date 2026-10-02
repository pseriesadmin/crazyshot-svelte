import { describe, it, expect } from 'vitest'
import { buildCouponBreakdown, type OrderCouponInput } from '../../lib/utils/orderCouponBreakdown'

/**
 * 결제정보 탭 "할인쿠폰 적용" 아코디언 — 쿠폰별 할인 계산 단계 (2026-10-02)
 * Harness Flow v3.2 — RED → GREEN
 *
 * 완료기준(B-START):
 *   정상 동작   : 서버 정본(apply_order_coupon_discounts, Migration 621)과 같은 순서·산식으로 쿠폰별 단계를 만든다
 *                정액 쿠폰 전부 먼저 → 정률은 같은 기준에 율 합산(1일차 한정은 1일차 몫 기준, 쿠폰별 한도) → 무료배송은 배송비 한도.
 *   막아야 할 것 : 화면이 서버와 다른 금액을 보여주는 것(합계·잔액 불일치).
 *   실패했을 때  : 관리자가 쿠폰별 금액을 검증할 수 없고 최종금액이 왜 그런지 설명할 수 없다.
 *
 * 실제 사례: 조이서 주문 45 — 합계 35,000 / 정액 10,000 + 30% + 방문 10%(1일차 한정, 1일 대여) → 10,000 + 7,500 + 2,500 = 20,000 → 15,000.
 */

const FIXED_ID = '859f9e2a-76f2-454b-920c-605868d88b49'
const PCT30_ID = 'a02279e4-7498-4e60-aa6a-c01bf6e29267'
const PCT10_ID = 'fed8365f-3c1b-4ba0-a453-8af671bd0b41'

function c(over: Partial<OrderCouponInput> & Pick<OrderCouponInput, 'couponId' | 'discountType' | 'discountValue'>): OrderCouponInput {
  return { name: '쿠폰', maxDiscountAmount: null, ...over }
}

describe('buildCouponBreakdown', () => {
  it('실제 사례: 정액 10,000 + 30% + 10%(1일차 한정, 1일 대여) → 20,000 할인, 잔액 15,000 (입력 순서가 뒤섞여도 정액 → 정률 id 순)', () => {
    const r = buildCouponBreakdown(35000, [
      c({ couponId: PCT10_ID, discountType: 'percentage', discountValue: 10, name: '방문 픽업·반납 10%', discountScope: 'first_day' }),
      c({ couponId: FIXED_ID, discountType: 'fixed', discountValue: 10000, name: '리뷰이벤트 10,000P' }),
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 30, name: '첫 렌탈 30%' }),
    ], 0, 35000)

    expect(r.steps.map(s => s.couponId)).toEqual([FIXED_ID, PCT30_ID, PCT10_ID])
    expect(r.steps.map(s => s.baseAmount)).toEqual([35000, 25000, 25000])
    expect(r.steps.map(s => s.discountAmount)).toEqual([10000, 7500, 2500])
    expect(r.steps.map(s => s.balanceAfter)).toEqual([25000, 17500, 15000])
    expect(r.steps.map(s => s.scope)).toEqual(['order', 'order', 'first_day'])
    expect(r.totalDiscount).toBe(20000)
    expect(r.finalBalance).toBe(15000)
  })

  it('정률은 합산: 미친할인 30%(주문) + 방문 10%(1일차), 2일 대여(1일차 25,000/총 50,000) → 15,000 + 2,500', () => {
    const r = buildCouponBreakdown(50000, [
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 30 }),
      c({ couponId: PCT10_ID, discountType: 'percentage', discountValue: 10, discountScope: 'first_day' }),
    ], 0, 25000)
    expect(r.steps.map(s => s.discountAmount)).toEqual([15000, 2500])
    expect(r.steps[1].basisLabel).toBe('1일차 요금(정액 차감 후)')
    expect(r.steps[1].baseAmount).toBe(25000)
    expect(r.totalDiscount).toBe(17500)
  })

  it('정액 + 1일차 정률: 기준은 정액 차감 후 잔액 중 1일차 몫(R1 = B1×R/T)', () => {
    const r = buildCouponBreakdown(50000, [
      c({ couponId: FIXED_ID, discountType: 'fixed', discountValue: 10000 }),
      c({ couponId: PCT10_ID, discountType: 'percentage', discountValue: 10, discountScope: 'first_day' }),
    ], 0, 25000)
    expect(r.steps[1].baseAmount).toBe(20000) // 40,000 × 25,000/50,000
    expect(r.steps[1].discountAmount).toBe(2000)
  })

  it('합계가 잔액을 넘지 않는다: 60% + 60% → 60,000 + 40,000', () => {
    const r = buildCouponBreakdown(100000, [
      c({ couponId: FIXED_ID, discountType: 'percentage', discountValue: 60 }),
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 60 }),
    ], 0)
    expect(r.steps.map(s => s.discountAmount)).toEqual([60000, 40000])
    expect(r.finalBalance).toBe(0)
  })

  it('정률 한도(max_discount_amount): 한도를 넘으면 한도로 제한하고 capped=true', () => {
    const r = buildCouponBreakdown(100000, [
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 50, maxDiscountAmount: 20000 }),
    ], 0)
    expect(r.steps[0].discountAmount).toBe(20000)
    expect(r.steps[0].capped).toBe(true)
    expect(r.finalBalance).toBe(80000)
  })

  it('한도 미만이면 capped=false', () => {
    const r = buildCouponBreakdown(100000, [
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 10, maxDiscountAmount: 20000 }),
    ], 0)
    expect(r.steps[0].discountAmount).toBe(10000)
    expect(r.steps[0].capped).toBe(false)
  })

  it('정률 반올림은 서버 ROUND와 같다(소수 .5는 올림): 25 × 10% = 2.5 → 3', () => {
    const r = buildCouponBreakdown(25, [c({ couponId: PCT10_ID, discountType: 'percentage', discountValue: 10 })], 0)
    expect(r.steps[0].discountAmount).toBe(3)
  })

  it('정액이 합계보다 크면 잔액은 0 아래로 내려가지 않는다(할인액은 액면 그대로 기록)', () => {
    const r = buildCouponBreakdown(5000, [c({ couponId: FIXED_ID, discountType: 'fixed', discountValue: 10000 })], 0)
    expect(r.steps[0].discountAmount).toBe(10000)
    expect(r.steps[0].balanceAfter).toBe(0)
    expect(r.finalBalance).toBe(0)
    expect(r.totalDiscount).toBe(10000)
  })

  it('정액 잔액 0 이후의 정률은 0원 — 처음 0원이던 사고 사례(합계 10,000 + 정액 10,000 + 30% + 10%)', () => {
    const r = buildCouponBreakdown(10000, [
      c({ couponId: FIXED_ID, discountType: 'fixed', discountValue: 10000 }),
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 30 }),
      c({ couponId: PCT10_ID, discountType: 'percentage', discountValue: 10 }),
    ], 0)
    expect(r.steps.map(s => s.discountAmount)).toEqual([10000, 0, 0])
    expect(r.finalBalance).toBe(0)
    expect(r.totalDiscount).toBe(10000)
  })

  it('무료배송 쿠폰: 배송비 한도 내에서만 차감하고 요금 잔액에는 영향이 없다', () => {
    const r = buildCouponBreakdown(40000, [
      c({ couponId: PCT10_ID, discountType: 'free_shipping', discountValue: 5000 }),
    ], 3000)
    expect(r.steps[0].discountAmount).toBe(3000)
    expect(r.steps[0].baseAmount).toBe(3000) // 배송비
    expect(r.steps[0].balanceAfter).toBe(0)   // 배송비 잔액
    expect(r.finalBalance).toBe(40000)
    expect(r.totalDiscount).toBe(3000)
  })

  it('무료배송 쿠폰 여러 장은 배송비 합계 한도를 공유한다(서버: LEAST(합계, 배송비))', () => {
    const r = buildCouponBreakdown(40000, [
      c({ couponId: FIXED_ID, discountType: 'free_shipping', discountValue: 2000 }),
      c({ couponId: PCT30_ID, discountType: 'free_shipping', discountValue: 2000 }),
    ], 3000)
    expect(r.steps.map(s => s.discountAmount)).toEqual([2000, 1000])
    expect(r.totalDiscount).toBe(3000)
  })

  it('쿠폰이 없으면 빈 단계·할인 0·잔액=합계', () => {
    const r = buildCouponBreakdown(35000, [], 0)
    expect(r.steps).toEqual([])
    expect(r.totalDiscount).toBe(0)
    expect(r.finalBalance).toBe(35000)
  })

  it('표시용 라벨: 정액은 "정액 N원", 정률은 "정률 N%"(한도 있으면 "최대 N원"), 무료배송은 "무료배송"', () => {
    const r = buildCouponBreakdown(100000, [
      c({ couponId: FIXED_ID, discountType: 'fixed', discountValue: 10000 }),
      c({ couponId: PCT30_ID, discountType: 'percentage', discountValue: 30, maxDiscountAmount: 20000 }),
      c({ couponId: PCT10_ID, discountType: 'free_shipping', discountValue: 3000 }),
    ], 3000)
    expect(r.steps.map(s => s.rateLabel)).toEqual(['정액 10,000원', '정률 30% (최대 20,000원)', '무료배송 (최대 3,000원)'])
  })
})
