/**
 * 장바구니 쿠폰·포인트 관련 순수 계산 (화면 계산식을 단위 테스트할 수 있도록 분리).
 */

/** 부가세 포함가에서 부가세(10%)를 역산한다. 합계에 더하지 않는 "안내용" 금액. */
export function calcIncludedVat(amount: number): number {
  const base = Math.max(0, amount)
  return Math.round(base - base / 1.1)
}

/**
 * 부가세 안내 기준액 — 쿠폰 할인 후 금액에서 사용 포인트도 차감한다(0 미만은 0).
 * 예: 246,000 − 쿠폰 5,000 − 포인트 1,000 = 240,000 → 부가세 21,818.
 */
export function calcVatForCart(netAfterCoupon: number, pointsUsed: number): number {
  return calcIncludedVat(Math.max(0, netAfterCoupon - Math.max(0, pointsUsed)))
}

/**
 * 쿠폰 남은 일수. null = "기한 없음"(unlimited 또는 만료일 미설정).
 * - relative_days: 처음 열람 전(firstViewedAt 없음)이면 카운트다운 전이므로 전체 유효일수를 그대로 반환.
 */
export function couponDaysLeft(
  validUntil: string | null,
  validityType: string | undefined,
  firstViewedAt: string | null | undefined,
  validDays: number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (validityType === 'relative_days') {
    if (!validDays) return null
    if (!firstViewedAt) return validDays
    const expiry = new Date(firstViewedAt).getTime() + validDays * 86400_000
    return Math.max(0, Math.ceil((expiry - now) / 86400_000))
  }
  if (validityType === 'unlimited' || !validUntil) return null
  return Math.max(0, Math.ceil((new Date(validUntil).getTime() - now) / 86400_000))
}
