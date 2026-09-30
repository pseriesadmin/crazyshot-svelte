/**
 * 장바구니 "적립 예정 포인트" 계산 — 서버 award_rental_complete_points와 같은 산식.
 * base: order_items.line_total 합계에 해당하는 금액(대여료+옵션료, 멤버십 할인·배송비·쿠폰·포인트 사용 차감 전, 판매전용 제외)
 * rate: CMS 적립 규칙(point_earn_rules.rental_complete)의 비율값(0.003 = 0.3%). 규칙이 없거나 비활성이면 null.
 * 서버는 ROUND(base * rate)를 쓰므로 양수 기준 Math.round와 동일하게 반올림한다.
 */
export function calcEarnPoints(base: number, rate: number | null | undefined): number {
  if (!rate || !Number.isFinite(rate) || rate <= 0) return 0
  if (!Number.isFinite(base) || base <= 0) return 0
  return Math.max(0, Math.round(base * rate))
}
