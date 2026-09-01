/**
 * 장바구니 화면의 대여기간/요금 "미리보기" 계산 — 서버 정본 RPC(calculate_cart_total,
 * migration 179)와 동일한 산식을 클라이언트에서 재현한다.
 *
 * 배경(2026-09-01, 실사용 중 발견): 기존 cart/+page.svelte의 rentalDays()가 당일대여
 * (start===end)일 때 0을 반환해 "총 대여기간"이 "날짜 미선택"으로 잘못 표시되고
 * pricingReady 게이팅이 막혀 결제 진행이 되지 않던 CRITICAL 버그. 또한 기존 itemCardRate()는
 * 다일 대여 시 일수를 전혀 곱하지 않는 단일요율 근사값이라 "N일+12시간" 조합 요금이 반영되지
 * 않았다. 이 파일은 calculate_cart_total의 산식(당일: 분단위 차이로 12h/24h 요율 판정,
 * 다일: 일수×24h요율 + 시(hour)단위 잔여시간 12시간 이상 시 12h요율 가산)을 그대로 재현해
 * 미리보기 금액이 실제 결제금액과 항상 일치하도록 한다.
 */

/** "HH:MM" → 분(minute) 단위. 빈 값은 00:00으로 취급 */
function timeToMinutes(time: string | null | undefined): number {
  const [h, m] = (time || '00:00').split(':')
  return (parseInt(h ?? '0', 10) || 0) * 60 + (parseInt(m ?? '0', 10) || 0)
}

/**
 * 총 대여일수(표시용). 당일 대여(startDate === endDate)는 1일로 표시한다
 * — 과거 버전은 0을 반환해 "날짜 미선택"으로 오인되던 버그가 있었음.
 */
export function calcRentalDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0
  if (startDate === endDate) return 1
  const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime()
  return Math.max(1, Math.round(diffMs / 86400000))
}

export interface RentalFeeInput {
  startDate: string
  endDate: string
  pickupTime: string | null
  returnTime: string | null
  dailyPrice: number
  halfDayPrice: number
}

/**
 * 대여요금(옵션 제외) — calculate_cart_total RPC와 동일 산식.
 * 당일 대여: 수령~반납 분(minute) 차이로 12h/24h 요율 판정(12시간 이하=half, 초과=daily,
 *   0 이하=0원).
 * 다일 대여: (반납일-수령일) × daily + 잔여시간(시 단위, 분 무시 — RPC와 동일 규칙) 12시간
 *   이상이면 half 가산.
 */
export function calcRentalFee(input: RentalFeeInput): number {
  const { startDate, endDate, pickupTime, returnTime, dailyPrice, halfDayPrice } = input
  if (!startDate || !endDate) return 0

  const pickupMins = timeToMinutes(pickupTime)
  const returnMins = timeToMinutes(returnTime)

  if (startDate === endDate) {
    const mins = returnMins - pickupMins
    if (mins <= 0) return 0
    return mins <= 720 ? halfDayPrice : dailyPrice
  }

  const totalDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
  let fee = totalDays * dailyPrice

  // RPC와 동일하게 시(hour) 단위만 비교(분은 무시) — v_remain_hours := ((r_hour-p_hour)%24+24)%24
  const pickupHour = Math.floor(pickupMins / 60)
  const returnHour = Math.floor(returnMins / 60)
  const remainHours = ((returnHour - pickupHour) % 24 + 24) % 24
  if (remainHours >= 12) fee += halfDayPrice

  return fee
}
