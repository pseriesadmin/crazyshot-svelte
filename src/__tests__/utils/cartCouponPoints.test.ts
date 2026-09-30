import { describe, it, expect } from 'vitest'
import { calcIncludedVat, calcVatForCart, couponDaysLeft } from '$lib/utils/cartCouponPoints'

describe('부가세 — 포인트 사용분 반영 (B-4)', () => {
  it('신고 예시: 246,000 − 쿠폰 5,000 − 포인트 1,000 = 240,000 → 21,818 (포인트 미반영 시 21,909)', () => {
    expect(calcVatForCart(241000, 1000)).toBe(21818)
    expect(calcIncludedVat(241000)).toBe(21909)
  })
  it('포인트가 기준액보다 커도 0 미만으로 내려가지 않는다', () => {
    expect(calcVatForCart(5000, 9000)).toBe(0)
  })
  it('포인트 0이면 기존과 동일', () => {
    expect(calcVatForCart(110000, 0)).toBe(10000)
  })
})

describe('쿠폰 남은 일수 — "기한 없음" 처리 (B-5)', () => {
  const now = Date.parse('2026-10-01T00:00:00+09:00')
  it('unlimited 또는 만료일 없음 → null(기한 없음), 0일로 표시하지 않는다', () => {
    expect(couponDaysLeft(null, 'unlimited', null, null, now)).toBeNull()
    expect(couponDaysLeft(null, undefined, null, null, now)).toBeNull()
  })
  it('고정기간: 남은 일수 올림, 지난 쿠폰은 0', () => {
    expect(couponDaysLeft('2026-10-04T00:00:00+09:00', 'fixed_period', null, null, now)).toBe(3)
    expect(couponDaysLeft('2026-09-25T00:00:00+09:00', 'fixed_period', null, null, now)).toBe(0)
  })
  it('상대기간: 처음 열람 전이면 전체 유효일수, 열람 후에는 경과 반영, 유효일수 없으면 기한 없음', () => {
    expect(couponDaysLeft(null, 'relative_days', null, 30, now)).toBe(30)
    expect(couponDaysLeft(null, 'relative_days', '2026-09-21T00:00:00+09:00', 30, now)).toBe(20)
    expect(couponDaysLeft(null, 'relative_days', null, null, now)).toBeNull()
  })
})
