/**
 * 쿠폰 "1인당 사용 횟수" 판정 — 사용자 보유 쿠폰(user_coupons 1행) 기준.
 *
 * 정책(Stephen 확정, 2026-10-02):
 *  - 한 사용자는 같은 쿠폰을 1장만 보유한다(user_coupons UNIQUE(user_id, coupon_id)). "사용 횟수"는 그 1행의 used_count다.
 *  - coupons.per_user_limit: 0 = 무제한(몇 번을 써도 장바구니에 계속 노출), N = N번 사용하면 장바구니 목록에서 제외.
 *  - 한도 미설정(NULL)은 과거 기본값 1회로 취급한다.
 * 서버 정본: private._validate_and_consume_coupon(Migration 623) — 같은 규칙. 장바구니·계약서·마이페이지·CMS 고객 화면이 이 함수를 공유한다.
 */

/**
 * CMS 폼 입력값 → 1인당 사용 횟수. 0은 "무제한"이라 사용자가 명시적으로 입력했을 때만 허용한다.
 * 빈 값·숫자가 아닌 값은 기본값 1(1회)로 처리하고, 음수·소수는 0 이상 정수로 정규화한다.
 */
export function parsePerUserLimit(raw: unknown): number {
  const text = String(raw ?? '').trim()
  if (text === '') return 1
  const n = Number(text)
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.floor(n))
}

/** 사용 횟수 — used_at은 있는데 used_count가 0/NULL인 과거 데이터는 1회로 본다 */
export function userCouponUsedCount(
  usedAt: string | null | undefined,
  usedCount: number | null | undefined,
): number {
  if (!usedAt) return 0
  return Math.max(usedCount ?? 0, 1)
}

/** 1인당 사용 횟수를 모두 써서 더 쓸 수 없는 상태인가 */
export function isUserCouponExhausted(
  usedAt: string | null | undefined,
  usedCount: number | null | undefined,
  perUserLimit: number | null | undefined,
): boolean {
  const used = userCouponUsedCount(usedAt, usedCount)
  if (used === 0) return false
  const limit = perUserLimit ?? 1
  if (limit <= 0) return false
  return used >= limit
}
