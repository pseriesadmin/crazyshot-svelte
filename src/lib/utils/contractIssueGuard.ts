/**
 * 계약서 발행/발송을 막아야 하는 예약 상태.
 * cancelled(취소) / expired(HOLD 30분 자동만료) — 둘 다 재고가 이미 해제된 종료 상태.
 * damage_claimed(파손 신고) — confirmed(계약서명 완료 필수) 이후에만 도달 가능해 이미
 * 서명이 끝난 상태라 재발행이 필요 없음. 셋 다 재발송 정책(rules-ref/contract.md
 * "모든 상태에서 항상 표시")의 예외 대상이다.
 */
export const CONTRACT_ISSUE_BLOCKED_STATUSES = ['cancelled', 'expired', 'damage_claimed'] as const

export function isContractIssueBlocked(status: string | null | undefined): boolean {
  return status != null && (CONTRACT_ISSUE_BLOCKED_STATUSES as readonly string[]).includes(status)
}
