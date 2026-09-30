/**
 * 렌탈 적립 포인트 계산 — 장바구니 "적립 예정 포인트"와 서버 award_rental_complete_points(Migration 606)가
 * 같은 식을 쓴다(2026-10-01 A-1 재정의, Stephen 확정).
 *
 * 적립 기준금액(부가세 포함가 기준) =
 *     대여료(상품+옵션) + 휴무일 연장요금
 *   − (멤버십 할인 + 상품분 쿠폰 할인 + 사용 포인트) 중 이 대여 라인의 몫
 *
 * 제외: 배송비·무료배송 쿠폰 할인분·구매(판매전용) 라인·보증금. 회원 등급 배율은 없다(정책상 등급 없음).
 * 할인 풀(D)은 주문의 모든 라인(대여+구매) 가중치(상품금액+휴무일요금) 비율로 나눠, 구매 라인이 흡수한 할인은
 * 대여 적립에서 빼지 않는다. 기준금액이 0 이하이면 0p. 포인트는 ROUND(기준금액 × 적립률)(양수 기준 Math.round와 동일).
 */

/** 적립률(0.003 = 0.3%)을 기준금액에 적용. 규칙 없음/비활성(null)·0 이하·기준금액 0 이하는 0p. */
export function calcEarnPoints(base: number, rate: number | null | undefined): number {
  if (!rate || !Number.isFinite(rate) || rate <= 0) return 0
  if (!Number.isFinite(base) || base <= 0) return 0
  return Math.max(0, Math.round(base * rate))
}

export interface EarnBaseInput {
  /** 대여 라인 합계(상품+옵션, 구매 제외) — order_items.line_total 중 대여분 */
  rentalAmount: number
  /** 대여 라인의 휴무일 연장요금 합계 */
  holidayFee: number
  /** 주문 전체(대여+구매) 상품 금액 — order_items.line_total 합계 */
  allAmount: number
  /** 주문 전체 휴무일 연장요금(구매 라인은 0이므로 보통 holidayFee와 같다) */
  allHolidayFee: number
  /** 멤버십 할인 */
  membershipDiscount: number
  /** 쿠폰 할인 합계(무료배송 쿠폰이 깎은 배송비분 포함 값도 허용 — freeShippingDiscount로 따로 빼준다) */
  couponDiscount: number
  /** 쿠폰 할인 중 배송비에 적용된 무료배송분(적립 기준에서 빼지 않는다) */
  freeShippingDiscount: number
  /** 실제 사용한 포인트 */
  pointsUsed: number
}

/** 대여 적립 기준금액. 음수는 0으로 제한한다. */
export function calcEarnBase(i: EarnBaseInput): number {
  const rentalWeight = Math.max(i.rentalAmount, 0) + Math.max(i.holidayFee, 0)
  const allWeight = Math.max(i.allAmount, 0) + Math.max(i.allHolidayFee, 0)
  if (rentalWeight <= 0 || allWeight <= 0) return 0
  const productCoupon = Math.max(i.couponDiscount - i.freeShippingDiscount, 0)
  const pool = Math.max(i.membershipDiscount, 0) + productCoupon + Math.max(i.pointsUsed, 0)
  // 풀 중 대여 라인의 몫 — 구매 라인이 없으면 rentalWeight === allWeight 이므로 풀 전체가 대여분
  const share = Math.round((pool * rentalWeight) / allWeight)
  return Math.max(rentalWeight - share, 0)
}

/**
 * 예약(라인) 단위 몫 배분 — 서버 award_rental_complete_points와 동일한 누적 반올림.
 * 라인을 예약 id 오름차순으로 놓고 각 라인의 몫 = ROUND(누적가중치×풀/전체) − ROUND(이전누적×풀/전체).
 * 라인별 몫의 합이 정확히 풀과 같아진다(반올림 잔여가 마지막 라인에 쌓임). TS↔SQL 패리티 테스트용.
 */
export function allocatePoolByCumulativeRounding(weights: number[], pool: number): number[] {
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0)
  if (total <= 0 || pool <= 0) return weights.map(() => 0)
  let cum = 0
  return weights.map((w) => {
    const prev = Math.round((cum * pool) / total)
    cum += Math.max(w, 0)
    return Math.round((cum * pool) / total) - prev
  })
}
