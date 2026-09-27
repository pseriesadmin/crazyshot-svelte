import { describe, it, expect } from 'vitest'
import { deriveCartMode, getPurchaseReservationDates, isRentalLine } from '$lib/utils/cartPurchaseMode'

/**
 * 장바구니 모드 판별 — deriveCartMode 순수함수 TDD
 * Harness Flow v3.2 | T1 RED→GREEN
 *
 * 체크된 + 미삭제 라인의 durationType 조합으로 카트 모드를 판별한다.
 *   'rental'   : 체크된 라인 전부 대여(purchase 아님)
 *   'purchase' : 체크된 라인 전부 구매(durationType==='purchase')
 *   'mixed'    : 대여 + 구매 혼재
 *   'empty'    : 체크된 미삭제 라인 없음(빈 카트, 전부 삭제/체크해제 포함)
 */

describe('deriveCartMode', () => {
  // ─────────────────────────────────────────────
  // Happy Path — 4종 모드 판별
  // ─────────────────────────────────────────────
  it('Happy: 체크된 대여 라인만 있으면 rental', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: '24h' },
      { deleted: false, checked: true, durationType: '12h' },
    ])).toBe('rental')
  })

  it('Happy: 체크된 구매 라인만 있으면 purchase', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: 'purchase' },
      { deleted: false, checked: true, durationType: 'purchase' },
    ])).toBe('purchase')
  })

  it('Happy: 대여 + 구매 혼재이면 mixed', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: '24h' },
      { deleted: false, checked: true, durationType: 'purchase' },
    ])).toBe('mixed')
  })

  it('Happy: 빈 배열이면 empty', () => {
    expect(deriveCartMode([])).toBe('empty')
  })

  // ─────────────────────────────────────────────
  // Edge — 삭제/체크해제 항목 무시
  // ─────────────────────────────────────────────
  it('Edge: 전부 삭제된 라인만 있으면 empty', () => {
    expect(deriveCartMode([
      { deleted: true, checked: true, durationType: '24h' },
      { deleted: true, checked: true, durationType: 'purchase' },
    ])).toBe('empty')
  })

  it('Edge: 전부 체크해제된 라인만 있으면 empty', () => {
    expect(deriveCartMode([
      { deleted: false, checked: false, durationType: '24h' },
      { deleted: false, checked: false, durationType: 'purchase' },
    ])).toBe('empty')
  })

  it('Edge: 삭제된 구매 라인 + 체크된 대여 라인 → 삭제 라인 무시 → rental', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: '24h' },
      { deleted: true, checked: true, durationType: 'purchase' },
    ])).toBe('rental')
  })

  it('Edge: 체크해제된 대여 라인 + 체크된 구매 라인 → 미체크 무시 → purchase', () => {
    expect(deriveCartMode([
      { deleted: false, checked: false, durationType: '24h' },
      { deleted: false, checked: true, durationType: 'purchase' },
    ])).toBe('purchase')
  })

  it('Edge: durationType이 null(DB 미저장)이면 대여로 분류', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: null },
    ])).toBe('rental')
  })

  it('Edge: durationType 1day는 대여로 분류', () => {
    expect(deriveCartMode([
      { deleted: false, checked: true, durationType: '1day' },
    ])).toBe('rental')
  })

  it('Edge: 삭제됐고 체크해제도 된 항목은 무시', () => {
    expect(deriveCartMode([
      { deleted: true, checked: false, durationType: 'purchase' },
      { deleted: false, checked: true, durationType: '24h' },
    ])).toBe('rental')
  })
})

// T3 (2026-09-27): 구매 라인 날짜 채움 함수 — TDD
// 구매 예약은 고객이 날짜를 선택하지 않으므로, 제출 시점의 "오늘" 날짜를
// start/end 양쪽에 자동 채워 promote_draft_reservation에 전달한다.
// F2 회귀 방지: 날짜가 null/''이면 compute_reservation_line_amount가 0원을 반환하므로
// 이 함수의 반환값은 반드시 유효한 YYYY-MM-DD 문자열이어야 한다.
describe('getPurchaseReservationDates', () => {
  it('Happy: 특정 날짜 주입 → 동일 날짜로 startDate/endDate 반환(1일 구매)', () => {
    const now = new Date(2026, 8, 27, 9, 0, 0) // 2026-09-27 09:00 로컬시간
    const dates = getPurchaseReservationDates(now)
    expect(dates.startDate).toBe('2026-09-27')
    expect(dates.endDate).toBe('2026-09-27')
  })

  it('Happy: startDate === endDate (구매는 항상 1일 기간)', () => {
    const now = new Date(2026, 8, 27, 0, 0, 0)
    const dates = getPurchaseReservationDates(now)
    expect(dates.startDate).toBe(dates.endDate)
  })

  it('Edge: 단자리 월(1월)·일(5일)도 2자리 패딩(YYYY-MM-DD 형식 준수)', () => {
    const now = new Date(2026, 0, 5, 12, 0, 0) // 2026-01-05
    const dates = getPurchaseReservationDates(now)
    expect(dates.startDate).toBe('2026-01-05')
    expect(dates.endDate).toBe('2026-01-05')
  })

  it('Edge: 반환 문자열 형식 YYYY-MM-DD (길이 10, 하이픈 위치 확인)', () => {
    const now = new Date(2026, 8, 27, 0, 0, 0)
    const dates = getPurchaseReservationDates(now)
    expect(dates.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dates.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // F2 회귀 방지: null/''이면 compute_reservation_line_amount가 0원 반환
  it('Error (F2 회귀): 반환값이 null/undefined/빈문자열이 아님(0원 방지)', () => {
    const now = new Date(2026, 8, 27, 0, 0, 0)
    const dates = getPurchaseReservationDates(now)
    expect(dates.startDate).toBeTruthy()
    expect(dates.endDate).toBeTruthy()
    expect(dates.startDate).not.toBe('')
    expect(dates.endDate).not.toBe('')
  })
})

// T4 (2026-09-27): 판매 라인 필터링 — isRentalLine()
// computeAllowedMethodIds(cartProductRows) 및 checkedAvailabilityItems(재고달력 입력)에서
// 판매전용(durationType='purchase') 라인을 제외한다.
//
// 문제 F6: sale_only 상품은 활성 자식(재고)이 0개일 수 있어,
//   checkedAvailabilityItems에 포함되면 get_unavailable_dates_for_cart가
//   모든 날짜를 차단 → 대여 달력 전체 마비.
// 문제 F8-①: sale_only 상품의 allowed_method_ids가 교집합에 섞이면
//   대여 방식 선택지가 좁아지거나 사라짐.
describe('isRentalLine', () => {
  // ─────────────────────────────────────────────
  // Happy Path — 대여 라인 판별
  // ─────────────────────────────────────────────
  it('Happy: durationType=24h → 대여 라인(true)', () => {
    expect(isRentalLine('24h')).toBe(true)
  })

  it('Happy: durationType=12h → 대여 라인(true)', () => {
    expect(isRentalLine('12h')).toBe(true)
  })

  it('Happy: durationType=1day → 대여 라인(true)', () => {
    expect(isRentalLine('1day')).toBe(true)
  })

  // ─────────────────────────────────────────────
  // Error Path — 구매 라인 → 제외
  // ─────────────────────────────────────────────
  it('Error: durationType=purchase → 구매 라인(false) — 달력/방식 교집합에서 제외', () => {
    expect(isRentalLine('purchase')).toBe(false)
  })

  // ─────────────────────────────────────────────
  // Edge — null/미저장 값은 대여로 처리(안전측)
  // ─────────────────────────────────────────────
  it('Edge: durationType=null(DB 미저장) → 대여로 취급(true) — F6 회귀 방지', () => {
    expect(isRentalLine(null)).toBe(true)
  })

  it('Edge: durationType=undefined → 대여로 취급(true)', () => {
    expect(isRentalLine(undefined)).toBe(true)
  })
})
