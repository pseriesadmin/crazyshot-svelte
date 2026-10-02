import { describe, it, expect } from 'vitest'
import { calcRentalFee, calcFirstDayFee, hasFullRentalDay, type RentalFeeInput } from '$lib/utils/cartRentalFee'

/**
 * 1일차 요금 — 서버 compute_reservation_line_amount.first_day_amount(Migration 621)와 같은 정의 (2026-10-02)
 *   24시간 이상 대여 → 1일(24h) 요금 / 12h 블록뿐 → 전체 요금. 휴무일 연장분을 뺀 최종 본상품 요금(netFee) 기준.
 */
const base = (over: Partial<RentalFeeInput> = {}): RentalFeeInput => ({
  startDate: '2026-10-10', endDate: '2026-10-11', pickupTime: '10:00', returnTime: '10:00',
  dailyPrice: 30000, halfDayPrice: 20000, ...over,
})

describe('calcFirstDayFee', () => {
  it('1박2일(24h 대여): 1일차 = 1일 요금', () => {
    const i = base()
    expect(calcFirstDayFee(i, calcRentalFee(i))).toBe(30000)
  })
  it('같은 날 12h 이내 대여: 1일차 = 전체(12h) 요금', () => {
    const i = base({ endDate: '2026-10-10', returnTime: '20:00' })
    expect(hasFullRentalDay(i)).toBe(false)
    expect(calcFirstDayFee(i, calcRentalFee(i))).toBe(20000)
  })
  it('13시간 대여(블록 2개): 하루로 청구되므로 1일차 = 1일 요금', () => {
    const i = base({ endDate: '2026-10-10', pickupTime: '08:00', returnTime: '21:00' })
    expect(hasFullRentalDay(i)).toBe(true)
    expect(calcFirstDayFee(i, calcRentalFee(i))).toBe(30000)
  })
  it('배송 잠금: 항상 1일 이상', () => {
    const i = base({ endDate: '2026-10-10', deliveryLocked: true })
    expect(calcFirstDayFee(i, calcRentalFee(i))).toBe(30000)
  })
  it('12h 요금 미등록: 1분이라도 대여하면 올림 1일', () => {
    const i = base({ endDate: '2026-10-10', returnTime: '12:00', halfDayPrice: null })
    expect(calcFirstDayFee(i, calcRentalFee(i))).toBe(30000)
  })
  it('최종 요금이 1일 요금보다 작으면(연장 차감 등) 최종 요금이 상한', () => {
    expect(calcFirstDayFee(base(), 10000)).toBe(10000)
  })
  it('요금이 0이면 1일차도 0', () => {
    expect(calcFirstDayFee(base(), 0)).toBe(0)
  })
})
