/**
 * 장바구니 모드 판별 + 구매 날짜 채움 순수함수
 * Harness Flow v3.2 | T1/T3 GREEN (2026-09-27)
 *
 * 체크된 미삭제 라인의 durationType 조합으로 카트의 현재 모드를 결정한다.
 * 이 값은 cart/+page.svelte에서 UI 분기(구매예약옵션 vs 대여예약옵션)와
 * 제출 게이트(T2)에 사용된다.
 *
 * getPurchaseReservationDates: 구매 라인은 고객이 날짜를 선택하지 않으므로
 * 제출 시점의 "오늘" 날짜를 start/end 양쪽에 자동 채운다.
 * F2 회귀 방지: compute_reservation_line_amount는 날짜가 null/''/미지정이면
 * 0원을 반환하므로 이 함수는 반드시 유효한 YYYY-MM-DD 문자열을 반환해야 한다.
 */

export type CartMode = 'rental' | 'purchase' | 'mixed' | 'empty'

export interface CartModeLine {
  /** UI 상태에서 소프트삭제된 항목인지 여부 */
  deleted: boolean
  /** 사용자가 체크박스로 선택한 상태 */
  checked: boolean
  /**
   * durationType: '12h' | '24h' | '1day' | 'purchase' | null
   * null 또는 'purchase'가 아닌 모든 값 → 대여(rental)로 분류한다.
   */
  durationType: string | null
}

/**
 * 체크된 미삭제 라인의 durationType 조합으로 카트 모드를 반환한다.
 *
 * - 삭제(deleted=true) 또는 체크해제(checked=false) 라인은 집계 대상에서 제외.
 * - 유효 라인이 없으면 'empty'.
 * - 유효 라인이 전부 durationType==='purchase'이면 'purchase'.
 * - 유효 라인에 'purchase' 와 비-purchase 둘 다 있으면 'mixed'.
 * - 그 외(전부 비-purchase)이면 'rental'.
 */
export function deriveCartMode(lines: CartModeLine[]): CartMode {
  const active = lines.filter(l => !l.deleted && l.checked)
  if (active.length === 0) return 'empty'

  const hasPurchase = active.some(l => l.durationType === 'purchase')
  const hasRental = active.some(l => l.durationType !== 'purchase')

  if (hasPurchase && hasRental) return 'mixed'
  if (hasPurchase) return 'purchase'
  return 'rental'
}

/**
 * 구매 라인 날짜 자동 채움 — T3 GREEN (2026-09-27)
 *
 * 구매 예약은 고객이 날짜를 선택하지 않으므로 제출 시점의 "오늘" 날짜를
 * startDate/endDate 양쪽에 동일하게 채운다(1일 기간 = 구매 의미).
 *
 * F2 회귀 방지: compute_reservation_line_amount는 날짜가 null이면 0원을 반환한다.
 * 이 함수의 반환값은 반드시 유효한 YYYY-MM-DD 문자열이어야 한다.
 *
 * @param now - 테스트 주입용 기준 날짜 (기본: 실행 시점의 로컬 날짜)
 */
/**
 * 대여 라인 판별 — T4 GREEN (2026-09-27)
 *
 * durationType === 'purchase'이면 false(구매 라인, 달력/방식 교집합 제외 대상).
 * null/undefined 또는 '12h'/'24h'/'1day' 등 그 외 모든 값은 true(대여 라인).
 *
 * 사용처:
 *   - cartProductRows: computeAllowedMethodIds() 입력에서 구매 라인의 allowed_method_ids를
 *     교집합에서 제외(F8-① 방지 — 구매 상품의 제한이 대여 방식 선택지를 좁히는 문제)
 *   - checkedAvailabilityItems: get_unavailable_dates_for_cart() 입력에서 구매 라인 제외
 *     (F6 방지 — sale_only 재고 0 시 전체 날짜 차단 문제)
 *   - applyBulkToItems: bulk 패널 날짜/방식/폼 브로드캐스트에서 구매 라인 제외
 */
export function isRentalLine(durationType: string | null | undefined): boolean {
  return durationType !== 'purchase'
}

export function getPurchaseReservationDates(now: Date = new Date()): { startDate: string; endDate: string } {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const today = `${y}-${m}-${d}`
  return { startDate: today, endDate: today }
}
