/**
 * canCancelReservation — 고객 셀프 "예약신청취소" 가능 여부 판정 (순수 함수)
 *
 * 취소 가능 조건:
 *   baseEligible = hold 상태 || (confirmed + 운송장 미등록)
 *   timeEligible = 배송방식이면 제약 없음, 비배송이면 방문 6시간 전까지
 *   canCancel    = baseEligible && timeEligible
 */
export function canCancelReservation({
  status,
  trackingNumber,
  isDeliveryType,
  startDate,
  pickupTime,
  nowMs = Date.now(),
}: {
  status: string
  trackingNumber: string | null | undefined
  isDeliveryType: boolean
  startDate: string | null | undefined
  pickupTime: string | null | undefined
  /** 테스트에서 주입 가능한 현재 시각 (기본: Date.now()) */
  nowMs?: number
}): boolean {
  // 취소 대상 상태: hold 또는 confirmed(미운송장)
  const baseEligible =
    status === 'hold' || (status === 'confirmed' && !trackingNumber)

  if (!baseEligible) return false

  // 배송 방식: 시간 제약 없음
  if (isDeliveryType) return true

  // 비배송(방문 수령): 방문 6시간 전까지만 취소 가능
  if (!startDate || !pickupTime) {
    // 방문 시각 정보 없으면 허용 (fallback — 정보 없이 차단하는 것은 부당)
    return true
  }

  // pickupTime은 "HH:MM" 또는 "HH:MM:SS" 형식
  const timeStr = pickupTime.length === 5 ? pickupTime : pickupTime.slice(0, 5)
  const pickupMs = new Date(`${startDate}T${timeStr}:00`).getTime()
  return nowMs < pickupMs - 6 * 60 * 60 * 1000
}
