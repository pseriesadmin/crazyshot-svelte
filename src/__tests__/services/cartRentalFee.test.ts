import { describe, it, expect } from 'vitest'
import { calcRentalDays, calcRentalFee, calcRentalMinutes, calcRentalPeriodParts } from '$lib/utils/cartRentalFee'

/**
 * 장바구니 대여기간/요금 미리보기 계산 — TDD
 * Harness Flow v3.2
 *
 * 배경: 실사용 중 발견된 CRITICAL 버그 2건
 *   1) 당일 대여(크레이지배송 "하루" 선택 등)가 "해당 기간에 재고가 없습니다"류 오해를 낳으며
 *      실제로는 rentalDays()가 0을 반환해 "날짜 미선택"으로 표시되고 결제가 막힘.
 *   2) 방문/퀵 등 12h·"N일+12h" 조합 요금이 화면에 반영되지 않음 — 클라이언트 미리보기가
 *      서버 정본(compute_reservation_line_amount RPC)의 일수×daily+잔여시간half가산 로직을
 *      따라하지 않고 단일요율 근사값만 쓰고 있었음.
 *
 * 배경(2026-09-03, Stephen 확정 — 12시간 블록 올림 재설계): "총 대여시간이 24시간을 조금이라도
 * 초과하면 즉시 +12시간 요금이 붙어야 한다"는 요구사항에 따라 calcRentalFee를 12시간(720분)
 * 블록 올림(ceil) 방식으로 재작성했다. calcRentalMinutes/calcRentalPeriodParts는 이 산식과
 * "총 대여기간" 표시 라벨(12시간/N일/N일 12시간)이 항상 같은 경계를 쓰도록 신설된 함수다.
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

describe('calcRentalMinutes', () => {
  it('EC-M1: 당일, 09:00→18:00 → 540분(9시간)', () => {
    expect(calcRentalMinutes('2026-09-01', '2026-09-01', '09:00', '18:00')).toBe(540)
  })

  it('EC-M2: 1박2일, 09:00→09:00(잔여 0) → 1440분(정확히 1일)', () => {
    expect(calcRentalMinutes('2026-09-01', '2026-09-02', '09:00', '09:00')).toBe(1440)
  })

  it('EC-M3: 1박2일, 09:00→18:00(잔여 9시간) → 1980분', () => {
    expect(calcRentalMinutes('2026-09-01', '2026-09-02', '09:00', '18:00')).toBe(1980)
  })

  it('EC-M4: 반납이 수령보다 빠름(역전) → 0', () => {
    expect(calcRentalMinutes('2026-09-01', '2026-09-01', '18:00', '09:00')).toBe(0)
  })

  it('EC-M5: 날짜 미선택 → 0', () => {
    expect(calcRentalMinutes('', '', '09:00', '18:00')).toBe(0)
  })

  describe('deliveryLocked(배송 왕복 잠금) — 2026-09-03 신설, "대여일 00:00~반납일 24:00"(Stephen 재확정)', () => {
    it('EC-M6: 수령일·반납일 날짜차이 1(예: 9일→10일), deliveryLocked면 두 날짜 모두 하루씩 포함해 2880분(2일)', () => {
      // bulkHandleMethod가 배송 잠금 시 채워 넣는 임시 기본값(12:00/13:00) — 실제 선택값이 아님
      expect(calcRentalMinutes('2026-09-01', '2026-09-02', '12:00', '13:00', true)).toBe(2880)
    })

    it('EC-M7: 날짜차이 3(예: 3박4일), deliveryLocked면 시각과 무관하게 (3+1)일=5760분(4일)', () => {
      expect(calcRentalMinutes('2026-09-01', '2026-09-04', '12:00', '13:00', true)).toBe(5760)
    })

    it('EC-M8: 당일(수령일=반납일), deliveryLocked면 (0+1)일=1440분(1일) — 최소 1일 보장과 결과적으로 동일', () => {
      expect(calcRentalMinutes('2026-09-01', '2026-09-01', '12:00', '13:00', true)).toBe(1440)
    })
  })
})

describe('calcRentalFee — 12시간 블록 올림 산식(compute_reservation_line_amount RPC와 정합)', () => {
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

  it('EC-7: 당일 대여, 정확히 12시간(09:00→21:00) → half 요율(경계값, 1블록)', () => {
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

  it('EC-9: 1박 2일, 동일 시각(09:00→09:00, 정확히 24시간=2블록) → daily × 1일만', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '09:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY)
  })

  it('EC-10: "Day+12h" 조합 — 1박 2일 + 잔여 정확히 12시간(09:00→21:00 다음날, 3블록) → daily + half', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '21:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY + HALF)
  })

  it('EC-11(2026-09-03 재확정): 1박2일 + 잔여 9시간(09:00→18:00 다음날, 33시간=24h 초과) → daily + half로 즉시 가산', () => {
    // 과거 산식(잔여시간이 hour 단위로 12시간 이상이어야 가산)에서는 daily만 부과됐으나,
    // Stephen 확정("24시간을 조금이라도 초과하면 즉시 +12시간 요금") 반영 후 daily+half로 변경.
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '18:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY + HALF)
  })

  it('EC-11b: 24시간 정확히(경계값, 초과 아님) → daily만(가산 없음)', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '09:00',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY)
  })

  it('EC-11c: 24시간을 1분만 초과(09:00→09:01 다음날) → 즉시 daily + half', () => {
    const fee = calcRentalFee({
      startDate: '2026-09-01', endDate: '2026-09-02',
      pickupTime: '09:00', returnTime: '09:01',
      dailyPrice: DAILY, halfDayPrice: HALF,
    })
    expect(fee).toBe(DAILY + HALF)
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

  describe('deliveryLocked(배송 왕복 잠금) — 2026-09-03 신설, "대여일 00:00~반납일 24:00"(Stephen 재확정)', () => {
    it('EC-14: 수령일 9일→반납일 10일(날짜차이 1), deliveryLocked=true면 두 날짜 모두 청구 → daily×2, half 없음', () => {
      const fee = calcRentalFee({
        startDate: '2026-09-01', endDate: '2026-09-02',
        pickupTime: '12:00', returnTime: '13:00',
        dailyPrice: DAILY, halfDayPrice: HALF,
        deliveryLocked: true,
      })
      expect(fee).toBe(DAILY * 2)
    })

    it('EC-14b: 동일 입력, deliveryLocked=false(기본값)면 여전히 daily+half(회귀 확인용 대조군)', () => {
      const fee = calcRentalFee({
        startDate: '2026-09-01', endDate: '2026-09-02',
        pickupTime: '12:00', returnTime: '13:00',
        dailyPrice: DAILY, halfDayPrice: HALF,
      })
      expect(fee).toBe(DAILY + HALF)
    })

    it('EC-15: 날짜차이 3(3박4일) + deliveryLocked → daily×4(half 없음)', () => {
      const fee = calcRentalFee({
        startDate: '2026-09-01', endDate: '2026-09-04',
        pickupTime: '12:00', returnTime: '13:00',
        dailyPrice: DAILY, halfDayPrice: HALF,
        deliveryLocked: true,
      })
      expect(fee).toBe(DAILY * 4)
    })

    it('EC-15b: 당일(수령일=반납일) + deliveryLocked → daily×1(최소 1일)', () => {
      const fee = calcRentalFee({
        startDate: '2026-09-01', endDate: '2026-09-01',
        pickupTime: '12:00', returnTime: '13:00',
        dailyPrice: DAILY, halfDayPrice: HALF,
        deliveryLocked: true,
      })
      expect(fee).toBe(DAILY)
    })
  })
})

describe('calcRentalPeriodParts — "총 대여기간" 표시 라벨(2026-09-03 신설)', () => {
  it('EC-P1: 0분 이하 → [] (날짜 미선택)', () => {
    expect(calcRentalPeriodParts(0)).toEqual([])
    expect(calcRentalPeriodParts(-10)).toEqual([])
  })

  it('EC-P2: 3시간(180분, 12시간 이내) → "12시간"', () => {
    expect(calcRentalPeriodParts(180)).toEqual([{ num: 12, unit: '시간' }])
  })

  it('EC-P3: 정확히 12시간(720분) → "12시간"(경계값)', () => {
    expect(calcRentalPeriodParts(720)).toEqual([{ num: 12, unit: '시간' }])
  })

  it('EC-P4: 20시간(1200분, 12시간 초과~24시간 이내) → "1일"', () => {
    expect(calcRentalPeriodParts(1200)).toEqual([{ num: 1, unit: '일' }])
  })

  it('EC-P5: 정확히 24시간(1440분) → "1일"(경계값, 초과 아님)', () => {
    expect(calcRentalPeriodParts(1440)).toEqual([{ num: 1, unit: '일' }])
  })

  it('EC-P6: 28시간(1680분, 24시간 초과) → "1일 12시간"', () => {
    expect(calcRentalPeriodParts(1680)).toEqual([{ num: 1, unit: '일' }, { num: 12, unit: '시간' }])
  })

  it('EC-P7: 정확히 36시간(2160분) → "1일 12시간"(경계값, 아직 2일 아님)', () => {
    expect(calcRentalPeriodParts(2160)).toEqual([{ num: 1, unit: '일' }, { num: 12, unit: '시간' }])
  })

  it('EC-P8: 36시간을 1분 초과 → "2일"', () => {
    expect(calcRentalPeriodParts(2161)).toEqual([{ num: 2, unit: '일' }])
  })
})
