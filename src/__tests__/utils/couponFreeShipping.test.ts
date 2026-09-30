import { describe, it, expect } from 'vitest'
import { FREE_SHIPPING_FULL_WAIVER, normalizeFreeShippingValue, isFullShippingWaiver } from '$lib/utils/couponFreeShipping'

describe('무료배송 쿠폰 할인값 정규화 (B-7)', () => {
  it('free_shipping + 빈 값/0/음수/NaN → 전액 면제 상한값(DB CHECK >0 만족)', () => {
    for (const v of [0, -1, Number.NaN]) {
      expect(normalizeFreeShippingValue('free_shipping', v)).toBe(FREE_SHIPPING_FULL_WAIVER)
    }
    expect(FREE_SHIPPING_FULL_WAIVER).toBeGreaterThan(0)
  })
  it('free_shipping + 금액 입력은 그대로 유지(기존 6,600원 쿠폰 등)', () => {
    expect(normalizeFreeShippingValue('free_shipping', 6600)).toBe(6600)
  })
  it('다른 유형은 값을 건드리지 않는다(0이면 기존 검증이 막음)', () => {
    expect(normalizeFreeShippingValue('fixed', 0)).toBe(0)
    expect(normalizeFreeShippingValue('percentage', 10)).toBe(10)
  })
  it('전액 면제 판별', () => {
    expect(isFullShippingWaiver(FREE_SHIPPING_FULL_WAIVER)).toBe(true)
    expect(isFullShippingWaiver(6600)).toBe(false)
  })
})
