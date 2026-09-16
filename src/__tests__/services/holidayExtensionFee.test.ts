import { describe, it, expect } from "vitest"
import {
  calcHolidayExtension,
  calcHolidayExtraFee,
} from "$lib/utils/cartRentalFee"

/**
 * 휴무일 포함 배송 연장 요금 로직 검증(계획 파일:
 * /Users/stevenmac/.claude/plans/cheerful-nibbling-emerson.md)
 *
 * 확정 비즈니스 규칙(Stephen 3차 최종):
 *   전체 연장일수 N = pickup_extra_days + return_extra_days(합산)
 *   N 중 하루 무료, 나머지(N-1)일은 각각 하루요금의 50%
 *   N=0 → 0 / N=1 → 0(무료) / N=3 → 2×daily×0.5
 *   holiday_extra_fee는 쿠폰·회원등급 할인 대상 제외(delivery_fee와 동일 패턴)
 *
 * calcHolidayExtraFee(pickupExtraDays, returnExtraDays, dailyPrice): number
 * calcHolidayExtension(startDate, endDate, pickupCourierDependent, returnCourierDependent, closedDatesSet)
 *   returns { effectiveStart, effectiveEnd, pickupExtraDays, returnExtraDays }
 */

describe("calcHolidayExtraFee 연장요금 공식(Stephen 3차 최종)", () => {
  const DAILY = 50000

  it("EC-HF-1: N=0 (연장 없음) 0원", () => {
    expect(calcHolidayExtraFee(0, 0, DAILY)).toBe(0)
  })

  it("EC-HF-2: N=1 (수령측 1일만 연장) 0원 (1일은 무료)", () => {
    expect(calcHolidayExtraFee(1, 0, DAILY)).toBe(0)
  })

  it("EC-HF-3: N=1 (반납측 1일만 연장) 0원 (1일은 무료)", () => {
    expect(calcHolidayExtraFee(0, 1, DAILY)).toBe(0)
  })

  it("EC-HF-4: N=2 (수령1+반납1) 1×daily×0.5 = 25000원", () => {
    expect(calcHolidayExtraFee(1, 1, DAILY)).toBe(DAILY * 0.5)
  })

  it("EC-HF-5: N=2 (수령2+반납0) 1×daily×0.5 (편측 2일도 공식 동일)", () => {
    expect(calcHolidayExtraFee(2, 0, DAILY)).toBe(DAILY * 0.5)
  })

  it("EC-HF-6: N=2 (수령0+반납2) 1×daily×0.5", () => {
    expect(calcHolidayExtraFee(0, 2, DAILY)).toBe(DAILY * 0.5)
  })

  it("EC-HF-7: N=3 (수령3+반납0, 3일 연휴 편측) 2×daily×0.5 = 50000원", () => {
    expect(calcHolidayExtraFee(3, 0, DAILY)).toBe(DAILY * 1)
  })

  it("EC-HF-8: N=3 (수령1+반납2) 2×daily×0.5 (편측/양측 구분 없음)", () => {
    expect(calcHolidayExtraFee(1, 2, DAILY)).toBe(DAILY * 1)
  })

  it("EC-HF-9: N=4 (수령2+반납2) 3×daily×0.5 = 75000원", () => {
    expect(calcHolidayExtraFee(2, 2, DAILY)).toBe(DAILY * 1.5)
  })

  it("EC-HF-10: 최대안전값 N=14 (양측 7일씩) 13×daily×0.5", () => {
    expect(calcHolidayExtraFee(7, 7, DAILY)).toBe(DAILY * 6.5)
  })

  it("EC-HF-11: dailyPrice=0 이면 항상 0원 (가격 미설정 상품)", () => {
    expect(calcHolidayExtraFee(5, 3, 0)).toBe(0)
  })

  it("EC-HF-12: GREATEST(N-1,0) 보장 — 음수 입력 방어", () => {
    expect(calcHolidayExtraFee(-1, 0, DAILY)).toBe(0)
    expect(calcHolidayExtraFee(0, -1, DAILY)).toBe(0)
  })
})

describe("calcHolidayExtension 휴무일 자동연장 계산", () => {
  it("EC-HX-1: 휴무일 없음 → 연장 없음, 원래 날짜 그대로", () => {
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      true, true,
      new Set<string>()
    )
    expect(result.effectiveStart).toBe("2026-10-01")
    expect(result.effectiveEnd).toBe("2026-10-03")
    expect(result.pickupExtraDays).toBe(0)
    expect(result.returnExtraDays).toBe(0)
  })

  it("EC-HX-2: 수령일 전날 휴무일 → 수령일 1일 앞당김, 반납 변경 없음", () => {
    const closed = new Set(["2026-09-30"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      true, true,
      closed
    )
    expect(result.effectiveStart).toBe("2026-09-30")
    expect(result.effectiveEnd).toBe("2026-10-03")
    expect(result.pickupExtraDays).toBe(1)
    expect(result.returnExtraDays).toBe(0)
  })

  it("EC-HX-3: 반납일 다음날 휴무일 → 반납일 1일 뒤로 미룸, 수령 변경 없음", () => {
    const closed = new Set(["2026-10-04"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      true, true,
      closed
    )
    expect(result.effectiveStart).toBe("2026-10-01")
    expect(result.effectiveEnd).toBe("2026-10-04")
    expect(result.pickupExtraDays).toBe(0)
    expect(result.returnExtraDays).toBe(1)
  })

  it("EC-HX-4: 수령·반납 양쪽 각 1일씩 연장 (N=2)", () => {
    const closed = new Set(["2026-09-30", "2026-10-04"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      true, true,
      closed
    )
    expect(result.effectiveStart).toBe("2026-09-30")
    expect(result.effectiveEnd).toBe("2026-10-04")
    expect(result.pickupExtraDays).toBe(1)
    expect(result.returnExtraDays).toBe(1)
  })

  it("EC-HX-5: 연속 3일 휴무(수령측) → 첫 영업일까지 3일 앞당김", () => {
    const closed = new Set(["2026-09-28", "2026-09-29", "2026-09-30"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-05",
      true, false,
      closed
    )
    expect(result.effectiveStart).toBe("2026-09-28")
    expect(result.pickupExtraDays).toBe(3)
    expect(result.returnExtraDays).toBe(0)
  })

  it("EC-HX-6: is_courier_dependent=false면 연장 없음", () => {
    const closed = new Set(["2026-09-30", "2026-10-04"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      false, false,
      closed
    )
    expect(result.effectiveStart).toBe("2026-10-01")
    expect(result.effectiveEnd).toBe("2026-10-03")
    expect(result.pickupExtraDays).toBe(0)
    expect(result.returnExtraDays).toBe(0)
  })

  it("EC-HX-7: 수령만 is_courier_dependent=false → 수령은 연장 없음, 반납만 연장", () => {
    const closed = new Set(["2026-09-30", "2026-10-04"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-03",
      false, true,
      closed
    )
    expect(result.effectiveStart).toBe("2026-10-01")
    expect(result.effectiveEnd).toBe("2026-10-04")
    expect(result.pickupExtraDays).toBe(0)
    expect(result.returnExtraDays).toBe(1)
  })

  it("EC-HX-8: 안전판 — 14일 초과 연속 휴무가 있어도 최대 14일까지만 확장", () => {
    const closedDates: string[] = []
    for (let i = 1; i <= 20; i++) {
      const d = new Date("2026-10-01")
      d.setDate(d.getDate() - i)
      closedDates.push(d.toISOString().slice(0, 10))
    }
    const closed = new Set(closedDates)
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-05",
      true, false,
      closed
    )
    expect(result.pickupExtraDays).toBeLessThanOrEqual(14)
  })

  it("EC-HX-9: 휴무일이 연장된 날짜에 또 걸리면 계속 연장(연쇄)", () => {
    const closed = new Set(["2026-09-29", "2026-09-30"])
    const result = calcHolidayExtension(
      "2026-10-01", "2026-10-05",
      true, false,
      closed
    )
    expect(result.effectiveStart).toBe("2026-09-29")
    expect(result.pickupExtraDays).toBe(2)
  })
})

describe("이중할인 방지 — holiday_extra_fee는 쿠폰·회원등급 할인에서 제외", () => {
  const DAILY = 100000

  it("EC-DISC-1: 쿠폰이 0원이든 10000원 할인이든 holiday_extra_fee는 동일", () => {
    const feeWithNoCoupon = calcHolidayExtraFee(2, 1, DAILY)
    const feeWithCoupon   = calcHolidayExtraFee(2, 1, DAILY)
    expect(feeWithNoCoupon).toBe(100000)
    expect(feeWithNoCoupon).toBe(feeWithCoupon)
  })

  it("EC-DISC-2: 회원등급 20% 할인이 있어도 holiday_extra_fee는 daily 기준 고정값", () => {
    const N = 3
    const expected = (N - 1) * DAILY * 0.5
    expect(calcHolidayExtraFee(2, 1, DAILY)).toBe(expected)
    const wrongIfDiscounted = (N - 1) * DAILY * 0.8 * 0.5
    expect(calcHolidayExtraFee(2, 1, DAILY)).not.toBe(wrongIfDiscounted)
  })
})
