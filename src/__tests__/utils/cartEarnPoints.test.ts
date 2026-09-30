import { describe, it, expect } from 'vitest'
import { calcEarnPoints, calcEarnBase, allocatePoolByCumulativeRounding } from '$lib/utils/cartEarnPoints'

describe('calcEarnPoints — 서버 award_rental_complete_points 산식과 일치', () => {
  it('0.3%: 375,000원 → 1,125p (기존 5% 하드코딩이면 18,750p)', () => {
    expect(calcEarnPoints(375000, 0.003)).toBe(1125)
  })
  it('반올림: 10,000 × 0.003 = 30 / 1,000 × 0.003 = 3 / 100 × 0.003 = 0.3 → 0', () => {
    expect(calcEarnPoints(10000, 0.003)).toBe(30)
    expect(calcEarnPoints(1000, 0.003)).toBe(3)
    expect(calcEarnPoints(100, 0.003)).toBe(0)
  })
  it('규칙 없음·비활성(null/undefined)·0 이하 비율이면 0p — 임의 비율로 추정하지 않음', () => {
    expect(calcEarnPoints(375000, null)).toBe(0)
    expect(calcEarnPoints(375000, undefined)).toBe(0)
    expect(calcEarnPoints(375000, 0)).toBe(0)
    expect(calcEarnPoints(375000, -0.1)).toBe(0)
  })
  it('기준 금액이 0 이하·비정상이면 0p', () => {
    expect(calcEarnPoints(0, 0.003)).toBe(0)
    expect(calcEarnPoints(-5000, 0.003)).toBe(0)
    expect(calcEarnPoints(Number.NaN, 0.003)).toBe(0)
  })
})

describe('calcEarnBase — A-1 적립 기준금액(할인·포인트 차감 후, 휴무일 요금 포함)', () => {
  const base = { rentalAmount: 360000, holidayFee: 0, allAmount: 360000, allHolidayFee: 0, membershipDiscount: 0, couponDiscount: 0, freeShippingDiscount: 0, pointsUsed: 0 }
  it('할인·포인트 없음 → 대여료 그대로', () => {
    expect(calcEarnBase(base)).toBe(360000)
  })
  it('쿠폰 5,000 + 포인트 10,000 차감 → 345,000', () => {
    expect(calcEarnBase({ ...base, couponDiscount: 5000, pointsUsed: 10000 })).toBe(345000)
  })
  it('멤버십 할인도 차감', () => {
    expect(calcEarnBase({ ...base, membershipDiscount: 36000 })).toBe(324000)
  })
  it('휴무일 연장요금은 기준금액에 더해진다', () => {
    expect(calcEarnBase({ ...base, holidayFee: 20000, allHolidayFee: 20000 })).toBe(380000)
  })
  it('무료배송 쿠폰이 깎은 배송비분은 적립 기준에서 빼지 않는다', () => {
    expect(calcEarnBase({ ...base, couponDiscount: 3000 + 2500, freeShippingDiscount: 2500 })).toBe(357000)
  })
  it('구매(판매전용) 라인이 있으면 할인 풀을 가중치 비율로 나눈다 — 대여 라인 몫만 차감', () => {
    // 대여 300,000 + 구매 100,000, 쿠폰 10,000 → 대여 몫 7,500
    expect(calcEarnBase({ ...base, rentalAmount: 300000, allAmount: 400000, couponDiscount: 10000 })).toBe(292500)
  })
  it('기준금액이 0 이하이면 0, 대여 라인이 없으면 0', () => {
    expect(calcEarnBase({ ...base, pointsUsed: 999999 })).toBe(0)
    expect(calcEarnBase({ ...base, rentalAmount: 0, allAmount: 100000 })).toBe(0)
  })
  it('예시: 0.3% × 345,000 = 1,035p', () => {
    expect(calcEarnPoints(calcEarnBase({ ...base, couponDiscount: 5000, pointsUsed: 10000 }), 0.003)).toBe(1035)
  })
})

describe('allocatePoolByCumulativeRounding — 예약별 몫 배분(서버와 동일 누적 반올림)', () => {
  it('합이 정확히 풀과 같다', () => {
    const w = [100000, 100000, 100000]
    const a = allocatePoolByCumulativeRounding(w, 10000)
    expect(a.reduce((s, x) => s + x, 0)).toBe(10000)
    expect(a).toEqual([3333, 3334, 3333])
  })
  it('풀 0이면 전부 0', () => {
    expect(allocatePoolByCumulativeRounding([1, 2], 0)).toEqual([0, 0])
  })
})
