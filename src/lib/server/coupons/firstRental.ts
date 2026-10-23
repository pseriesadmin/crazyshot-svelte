// "첫 렌탈" 판정 단일 규칙 — 크레이지샷 예약 이력이 없고, 레거시(원 서비스) 구매 이력도 없어야 첫 렌탈이다.
// SQL 짝: private._validate_and_consume_coupon (Migration 751). 장바구니·계약서·couponEligibility가 공유한다.
export function isFirstRentalUser(completedReservationRows: number, legacyPurchaseCount: number | null | undefined): boolean {
  return completedReservationRows === 0 && (legacyPurchaseCount ?? 0) <= 0
}
