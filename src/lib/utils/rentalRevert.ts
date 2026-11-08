// 대여현황 단계 되돌리기 규칙 (Migration #799 revert_reservation_status 와 같은 허용표 — 함께 바꾼다)
// 반납중 → 대여중 / 대여중 → 반출중(배송형) · 계약완료(방문 수령). 반출중 이전·반납완료 이후는 되돌리지 않는다.

export function revertTarget(status: string, pickupMethod?: string | null): string | null {
  if (status === 'return_requested') return 'in_use'
  if (status === 'in_use') return pickupMethod === 'visit' ? 'confirmed' : 'shipped'
  return null
}

export function revertLabel(status: string, pickupMethod?: string | null): string {
  const target = revertTarget(status, pickupMethod)
  if (target === 'in_use') return '대여중 되돌림'
  if (target === 'shipped') return '반출중으로 되돌리기'
  if (target === 'confirmed') return '계약완료 되돌림'
  return ''
}

const REASON_MIN = 2
const REASON_MAX = 200

/** 사유 정리: 앞뒤 공백 제거 후 길이 검증. 통과하면 정리된 문자열, 아니면 null. */
export function normalizeRevertReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  return v.length >= REASON_MIN && v.length <= REASON_MAX ? v : null
}
