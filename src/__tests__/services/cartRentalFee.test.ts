import { describe, it, expect } from 'vitest'
import { calcRentalDays, calcRentalFee } from '$lib/utils/cartRentalFee'

/**
 * 장바구니 대여기간/요금 미리보기 계산 — TDD
 * Harness Flow v3.2
 *
 * 배경: 실사용 중 발견된 CRITICAL 버그 2건
 *   1) 당일 대여(크레이지배송 "하루" 선택 등)가 "해당 기간에 재고가 없습니다"류 오해를 낳으며
 *      실제로는 rentalDays()가 0을 반환해 "날짜 미선택"으로 표시되고 결제가 막힘.
 *   2) 방문/퀵 등 12h·"N일+12h" 조합 요금이 화면에 반영되지 않음 — 클라이언트 미리보기가
 *      서버 정본(calculate_cart_total RPC)의 일수×daily+잔여시간half가산 로직을 따라하지 않고
 *      단일요율 근사값만 쓰고 있었음.
 *
 * 이 테스트는 calculate_cart_total RPC(supabase/migrations/20260731000179_179_*.sql)의
 * 산식과 정확히 일치하는지를 검증 기준으로 삼는다.
 */

describe('calcRentalDays', () => {
  it('EC-1: 당일 대여(startDate===endDate) → 1일 (과거 버그: 0 반환)', () => {
    expect(calcRentalDays('2026-09-01', '2026-09-01')).toBe(1)
  })

  it('EC-2: 1박 2일(하루 차이) → 1일', () => {
    expect(calcRentalDays('2026-09-01', '2026-09-02')).toBe(1)
  })

  it('EC-3: 3박 4일(사흘 차이) → 3일', () => {
    expect(calcRentalDays('2026-09-01', '2026-09-04')).toBe(3)
  })

  it('EC-4: 날짜 미선택(빈 문자열) → 0', () => {
    expect(calcRentalDays('', '')).toBe(0)
    expect(calcRentalDays('2026-09-01', '')).toBe(0)
  })
})

describe('calcRentalFee — calculate_cart_total RPC 산식과 정합', () => {
  const DAILY = 30000
  const HALF = 20000

  it('EC-5: 당일 대여, 12시간 이하(09:00→18:00=9h) → half 요율', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-01',
      pickupTime: '09:00', returnTime: '18:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(HALF)
  })

  it('EC-6: 당일 대여, 12시간 초과(09:00→22:00=13h) → daily 요율', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-01',
      pickupTime: '09:00', returnTime: '22:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY)
  })

  it('EC-7: 당일 대여, 정확히 12시간(09:00→21:00) → half 요율(경계값, RPC의 <=720 포함)', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-01',
      pickupTime: '09:00', returnTime: '21:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(HALF)
  })

  it('EC-8: 당일 대여, 반납시각이 수령시각보다 빠름(역전) → 0원', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-01',
      pickupTime: '18:00', returnTime: '09:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(0)
  })

  it('EC-9: 1박 2일, 동일 시각(09:00→09:00, 잔여 0시간) → daily × 1일만', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '09:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY)
  })

  it('EC-10: "Day+12h" 조합 — 1박 2일 + 잔여 12시간 이상(09:00→21:00 다음날) → daily + half', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '21:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY + HALF)
  })

  it('EC-11: 1박 2일 + 잔여 12시간 미만(09:00→18:00 다음날, 9시간) → daily만(가산 없음)', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '18:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY)
  })

  it('EC-12: 3박 4일 + Day+12h 조합(09:00→21:00, 3일+12h) → daily×3 + half', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-04',
      pickupTime: '09:00', returnTime: '21:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY * 3 + HALF)
  })

  it('EC-13: 날짜 미선택 → 0원', () => {
    expect(calcRentalFee({
      startDate: '', endDate: '', pickupTime: '09:00', returnTime: '18:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })).toBe(0)
  })
})
