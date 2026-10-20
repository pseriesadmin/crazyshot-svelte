// chatMessageDelete.ts — 채팅 대화카드 개별 삭제(관리자 발송 취소) 규칙 (서버·화면 공용, 2026-10-20 Stephen 확정)
// 정책: ① 관리자·시스템·AI가 보낸 대화만 삭제 가능(고객 발신 불가) ② 결제·계약·쿠폰 카드 종류는 삭제 불가(이미 실행된 효과와 어긋나지 않게)
//       ③ 삭제되면 행이 '대화가 삭제되었습니다.' 시스템 메시지로 바뀐다(원본은 관리자 전용 보관 테이블 chat_message_deletions).
// 막힌 카드 종류 목록은 DB 함수 cms_delete_chat_message(Migration #733)와 같아야 한다 — 테스트(chatMessageDelete.test.ts)가 마이그레이션 파일과 대조한다.

export const DELETED_MESSAGE_TEXT = '대화가 삭제되었습니다.'

/** 삭제할 수 없는 카드(action_payload.type) — 결제·계약·쿠폰 */
export const NON_DELETABLE_CARD_TYPES = [
  'contract_link',
  'contract_signed',
  'payment_request',
  'PAYMENT_REQUEST_CARD',
  'coupon_issued',
  'COUPON_GIFT_CARD',
  'refund_failed',
] as const

interface DeletableCheckInput {
  sender_type: string
  message_type?: string | null
  action_payload?: { type?: string } | null
  deleted_at?: string | null
}

/** 이미 삭제된(삭제 표시로 교체된) 메시지인지 */
export function isDeletedChatMessage(m: Pick<DeletableCheckInput, 'deleted_at' | 'action_payload'>): boolean {
  return !!m.deleted_at || m.action_payload?.type === 'message_deleted'
}

/** 관리자 화면에서 삭제 아이콘을 보여줄 수 있는 메시지인지(서버·DB가 같은 규칙으로 다시 검증한다) */
export function isChatMessageDeletable(m: DeletableCheckInput): boolean {
  if (m.sender_type === 'user') return false
  if (isDeletedChatMessage(m)) return false
  const type = m.action_payload?.type
  if (type && (NON_DELETABLE_CARD_TYPES as readonly string[]).includes(type)) return false
  return true
}

/** DB 함수의 오류 코드를 관리자에게 보여줄 문구로 */
export function chatDeleteErrorMessage(code: string): { status: number; message: string } {
  if (code.startsWith('CARD_TYPE_NOT_DELETABLE')) return { status: 409, message: '결제·계약·쿠폰 관련 카드는 삭제할 수 없습니다.' }
  if (code === 'CUSTOMER_MESSAGE_NOT_DELETABLE') return { status: 403, message: '고객이 보낸 메시지는 삭제할 수 없습니다.' }
  if (code === 'ALREADY_DELETED') return { status: 409, message: '이미 삭제된 대화입니다.' }
  if (code === 'MESSAGE_NOT_FOUND') return { status: 404, message: '대화를 찾을 수 없습니다.' }
  return { status: 500, message: '대화 삭제에 실패했습니다.' }
}
