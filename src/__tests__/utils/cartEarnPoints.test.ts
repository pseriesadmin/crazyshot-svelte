import { describe, it, expect } from 'vitest'
import { calcEarnPoints } from '$lib/utils/cartEarnPoints'

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
