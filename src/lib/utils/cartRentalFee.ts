/**
 * 장바구니 화면의 대여기간/요금 "미리보기" 계산 — 서버 정본 RPC(compute_reservation_line_amount,
 * migration 179 calculate_cart_total → 251 헬퍼 추출 → 416 판매전용 분기)와 동일한 산식을
 * 클라이언트에서 재현한다.
 *
 * 배경(2026-09-01, 실사용 중 발견): 기존 cart/+page.svelte의 rentalDays()가 당일대여
 * (start===end)일 때 0을 반환해 "총 대여기간"이 "날짜 미선택"으로 잘못 표시되고
 * pricingReady 게이팅이 막혀 결제 진행이 되지 않던 CRITICAL 버그. 또한 기존 itemCardRate()는
 * 다일 대여 시 일수를 전혀 곱하지 않는 단일요율 근사값이라 "N일+12시간" 조합 요금이 반영되지
 * 않았다.
 *
 * 배경(2026-09-03, Stephen 확정 — 12시간 블록 올림 방식으로 재설계): 기존 산식은 다일 대여의
 * 잔여시간이 "시(hour) 단위 12시간 이상"일 때만 12h요율을 가산했다(예: 1박2일+9시간 잔여 →
 * daily만, 가산 없음). 그러나 실제 서비스 의도는 "24시간을 조금이라도 초과하면 즉시 +12시간
 * 요금이 붙는다"였음 — 총 대여시간을 12시간(720분) 단위 블록으로 올림(ceil) 처리해
 * 블록 2개=1일 요율, 홀수 블록이 남으면 12시간(half)요율을 가산하는 방식으로 교체했다.
 * 이 방식은 당일/다일 대여를 하나의 산식으로 통합하며, "총 대여기간" 표시 라벨(12시간/N일/
 * N일 12시간)도 동일한 블록 경계를 그대로 재사용한다.
 */

/** "HH:MM" → 분(minute) 단위. 빈 값은 00:00으로 취급 */
function timeToMinutes(time: string | null | undefined): number {
  const [h, m] = (time || '00:00').split(':')
  return (parseInt(h ?? '0', 10) || 0) * 60 + (parseInt(m ?? '0', 10) || 0)
}

/** 12시간 = 1블록. 대여요금·표시라벨 둘 다 이 블록 단위로 올림(ceil) 처리한다. */
const BLOCK_MINUTES = 720

/**
 * 총 대여일수(표시용, 레거시 — 시간 정보 없이 달력일수만 필요한 경우에만 사용).
 * 당일 대여(startDate === endDate)는 1일로 표시한다.
 * ⚠️ "총 대여기간" 화면 표시(12시간/N일/N일 12시간)는 이 함수가 아니라
 * calcRentalPeriodParts()를 사용할 것 — 이 함수는 시각(수령/반납 시간)을 전혀 반영하지 않는다.
 */
export function calcRentalDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0
  if (startDate === endDate) return 1
  const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime()
  return Math.max(1, Math.round(diffMs / 86400000))
}

/**
 * 총 대여시간(분) — 당일/다일 통합. 날짜 미입력이거나 반납이 수령보다 빠르면(역전) 0.
 * 여러 상품의 대여기간을 합산해 "총 대여기간"을 계산할 때도 이 값을 그대로 더하면 된다.
 *
 * @param deliveryLocked 2026-09-03(Stephen 확정) — 수령방식이 배송(CMS rental_method_options.
 *   is_bulk_delivery=true)으로 잠기면 반납방식도 강제로 배송 동일방식이 되어(요청 A) "왕복
 *   배송료" 조건이 성립하는데, 이 경우 시간선택 UI 자체가 화면에서 사라져(RentalForm의
 *   `{#if !locked}`) pickup_time/return_time이 사용자가 실제로 고른 값이 아니라 화면
 *   임시 기본값(12:00/13:00 — bulkHandleMethod)일 뿐이다. 그 임의의 1시간 차이를 12시간
 *   블록 산식에 그대로 넣으면 "N일"이어야 할 요금이 "N일+12시간"으로 잘못 가산된다.
 *   true면 시각을 무시하고 "대여일 00:00 ~ 반납일 24:00"(Stephen 확정 — 수령일·반납일
 *   두 날짜 모두 온전히 하루씩으로 포함, 즉 (반납일-수령일)+1일)을 정확히 24h의 배수로
 *   반환해 블록 산식이 자동으로 "N일"에서 멈추도록 한다(별도 분기 없이 동일 산식 재사용).
 *   예) 수령일 9일 · 반납일 10일(날짜차이 1) → 2일(9일 하루 + 10일 하루 모두 청구).
 */
export function calcRentalMinutes(
  startDate: string,
  endDate: string,
  pickupTime: string | null | undefined,
  returnTime: string | null | undefined,
  deliveryLocked?: boolean,
): number {
  if (!startDate || !endDate) return 0
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
  if (deliveryLocked) {
    return (Math.max(days, 0) + 1) * 1440
  }
  const total = days * 1440 + timeToMinutes(returnTime) - timeToMinutes(pickupTime)
  return total > 0 ? total : 0
}

export interface RentalFeeInput {
  startDate: string
  endDate: string
  pickupTime: string | null
  returnTime: string | null
  dailyPrice: number
  halfDayPrice: number
  /** 배송(왕복 배송료) 잠금 예약 — calcRentalMinutes 참고, 12시간 블록 산식을 건너뛰고 N일만 청구 */
  deliveryLocked?: boolean
}

/**
 * 대여요금(옵션 제외) — compute_reservation_line_amount RPC와 동일 산식(12시간 블록 올림).
 * 총 대여시간(분)을 720분(12h) 단위로 올림한 블록 수 기준:
 *   블록수 짝수 → (블록수/2)일 × daily
 *   블록수 홀수 → floor(블록수/2)일 × daily + half (마지막 12시간 블록 가산)
 * 예) 9시간→1블록(half만), 20시간→2블록(daily만), 25시간→3블록(daily+half, 24h를 1시간만
 *   넘어도 즉시 가산), 36시간→3블록(daily+half, 경계값은 아직 가산 없이 유지).
 */
export function calcRentalFee(input: RentalFeeInput): number {
  const { startDate, endDate, pickupTime, returnTime, dailyPrice, halfDayPrice, deliveryLocked } = input
  const totalMinutes = calcRentalMinutes(startDate, endDate, pickupTime, returnTime, deliveryLocked)
  if (totalMinutes <= 0) return 0

  const blocks = Math.ceil(totalMinutes / BLOCK_MINUTES)
  const days = Math.floor(blocks / 2)
  const hasHalfBlock = blocks % 2 === 1
  return days * dailyPrice + (hasHalfBlock ? halfDayPrice : 0)
}

export interface RentalPeriodPart {
  num: number
  unit: '일' | '시간'
}

/**
 * "총 대여기간" 표시 라벨 — calcRentalMinutes()(여러 상품 합산 가능)를 calcRentalFee()와
 * 동일한 12시간 블록 경계로 변환한다.
 *   0분 이하           → [] (호출부에서 "날짜 미선택" 분기)
 *   12시간 이내(1블록)  → [{num:12, unit:'시간'}]
 *   12시간 초과~24시간  → [{num:1, unit:'일'}]
 *   24시간 초과(3블록)  → [{num:1, unit:'일'}, {num:12, unit:'시간'}]
 */
export function calcRentalPeriodParts(totalMinutes: number): RentalPeriodPart[] {
  if (totalMinutes <= 0) return []

  const blocks = Math.ceil(totalMinutes / BLOCK_MINUTES)
  const days = Math.floor(blocks / 2)
  const hasHalfBlock = blocks % 2 === 1

  if (days === 0) return [{ num: 12, unit: '시간' }]
  const parts: RentalPeriodPart[] = [{ num: days, unit: '일' }]
  if (hasHalfBlock) parts.push({ num: 12, unit: '시간' })
  return parts
}
