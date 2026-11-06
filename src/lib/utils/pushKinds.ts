// 푸시알림 설정 화면 '고객 알림 — 예약~대여~반납' 목록의 종류별 서류철 탭 분류 (2026-11-06, Stephen 지시)
// 알림 유형(notify_type) → 종류. 표시 분류일 뿐 발송·설정 값에는 영향이 없다. 여기에 없는 새 유형은 '기타' 서류철로 모인다.

export interface PushKind {
  id: string
  label: string
}

export const PUSH_KINDS: readonly PushKind[] = [
  { id: 'reservation', label: '예약·결제' },
  { id: 'contract', label: '계약·서류' },
  { id: 'pickup', label: '수령·배송' },
  { id: 'return', label: '반납' },
  { id: 'inspection', label: '검수·완료·CS' },
  { id: 'chat', label: '상담 응답' },
]

export const OTHER_KIND: PushKind = { id: 'other', label: '기타' }

const KIND_BY_TYPE: Record<string, string> = {
  // 예약·결제
  reservation_hold: 'reservation',
  reservation_approval: 'reservation',
  reservation_cancelled: 'reservation',
  payment_cancelled_reissue: 'reservation',
  late_fee_request: 'reservation',
  late_fee_paid: 'reservation',
  // 계약·서류
  contract_sent: 'contract',
  contract_signed_customer: 'contract',
  identity_request: 'contract',
  identity_approved: 'contract',
  // 수령·배송
  rental_confirm: 'pickup',
  shipment_notify: 'pickup',
  tracking_notify: 'pickup',
  dhero_place_guide: 'pickup',
  locker_guide: 'pickup',
  // 반납
  return_registration: 'return',
  return_remind: 'return',
  return_notice_courier: 'return',
  return_notice_quick_5h: 'return',
  return_notice_quick_2h: 'return',
  return_notice_quick_1h: 'return',
  return_notice_locker: 'return',
  locker_return_guide: 'return',
  // 검수·완료·CS
  rental_complete: 'inspection',
  inspection_pass: 'inspection',
  inspection_issue: 'inspection',
  issue_report_request: 'inspection',
  damage_claimed: 'inspection',
  // 상담 응답
  admin_chat_reply: 'chat',
  chat_unanswered: 'chat',
  ai_auto_reply: 'chat',
  canned_auto_reply: 'chat',
}

export function pushKindOf(notifyType: string): string {
  return Object.prototype.hasOwnProperty.call(KIND_BY_TYPE, notifyType) ? KIND_BY_TYPE[notifyType] : OTHER_KIND.id
}

/**
 * 한 서류철(종류) 안에서 바꾼 순서를 전체 목록 순서에 합친다.
 * 전체 목록에서 그 서류철 항목이 차지하던 자리(위치)는 그대로 두고, 그 자리들에 새 순서대로 항목을 채운다 — 다른 서류철 항목의 위치는 바뀌지 않는다.
 * tabOrder 에 전체 목록에 없는 유형이 섞여 있거나 개수가 다르면(화면이 오래된 경우) 전체 목록을 그대로 돌려준다.
 */
export function mergeTabOrder<T extends { notify_type: string }>(globalList: readonly T[], tabOrder: readonly string[]): T[] {
  const inTab = new Set(tabOrder)
  const byType = new Map(globalList.map((r) => [r.notify_type, r] as const))
  const positions = globalList.map((r, i) => (inTab.has(r.notify_type) ? i : -1)).filter((i) => i >= 0)
  if (inTab.size !== tabOrder.length || positions.length !== tabOrder.length || tabOrder.some((t) => !byType.has(t))) return [...globalList]
  const result = [...globalList]
  positions.forEach((pos, k) => {
    result[pos] = byType.get(tabOrder[k]) as T
  })
  return result
}
