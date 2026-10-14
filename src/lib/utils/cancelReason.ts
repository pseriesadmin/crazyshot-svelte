// 예약 취소·환불 사유 분류(2026-10-14) — 예약 상세 패널 SuggestPicker 항목 + 서버 검증 공용.
// 코드 6종은 DB CHECK(rental_reservations_cancel_reason_chk)·cms_set_reservation_cancel_reason RPC와 같아야 한다.
export const CANCEL_REASON_NOTE_MAX = 200

export const CANCEL_REASON_OPTIONS = [
  { id: 'customer_change_mind', label: '고객 단순 변심' },
  { id: 'schedule_change', label: '고객 일정 변경·취소' },
  { id: 'stock_issue', label: '장비 재고·상태 문제(당사 사정)' },
  { id: 'no_response', label: '계약·결제 미진행(고객 무응답)' },
  { id: 'duplicate_error', label: '중복·오류 예약' },
  { id: 'other', label: '기타' },
] as const

export type CancelReasonCode = (typeof CANCEL_REASON_OPTIONS)[number]['id']

export function isCancelReasonCode(v: unknown): v is CancelReasonCode {
  return typeof v === 'string' && CANCEL_REASON_OPTIONS.some((o) => o.id === v)
}
