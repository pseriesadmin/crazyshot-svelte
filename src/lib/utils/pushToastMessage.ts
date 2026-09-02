// src/lib/utils/pushToastMessage.ts
// 채팅 대화카드 수신(FCM 포그라운드) 시 노출되는 안내 토스트 문구를 3종으로 단일화한다.
// 과거에는 push.ts가 발송 시점에 지정한 title/body를 그대로 이어붙여 보여줘 타입마다
// 문구가 제각각이었다(예: "답변이 도착했어요 — ...", "예약이 취소됐어요 — ..." 등) —
// Stephen 확정: 아래 3종 정형 문구로 통일한다.
//   ① 신규 대화(기본값)   : "새로운 대화를 확인하세요."
//   ② 질문에 대한 답변    : "새로운 답변을 확인하세요."
//   ③ 중요 실행 알림(정보) : "새로운 {정보명} 정보를 확인하세요."
// notifyType은 push.ts의 dispatch()가 항상 payload.data.notifyType으로 실어 보낸다.

// ② 질문에 대한 답변으로 분류되는 notifyType — 고객이 채팅에 입력한 질문/문의에 대한
// 직접 응답 성격(자동매칭·AI 자유응답·관리자 수동 답장)
const ANSWER_NOTIFY_TYPES = new Set<string>([
  'canned_auto_reply',
  'ai_auto_reply',
  'admin_chat_reply',
])

// ③ 중요 실행 알림(정보)로 분류되는 notifyType → 문구에 채워 넣을 정보명
// (예약/대여 라이프사이클 10종 + 계약·쿠폰·연체료·관리자용 이벤트)
const IMPORTANT_NOTIFY_LABELS: Record<string, string> = {
  reservation_hold:          '예약신청',
  reservation_approval:      '예약승인',
  shipment_notify:           '반출',
  rental_confirm:            '대여',
  return_registration:       '반납',
  return_remind:             '반납',
  rental_complete:           '대여완료',
  reservation_cancelled:     '예약취소',
  damage_claimed:            '파손신고',
  hold_expired:              '예약만료',
  contract_signed_customer:  '전자계약',
  coupon_gift:                '쿠폰',
  late_fee_paid:              '연체료',
  locker_guide:                '보관함',
  dhero_place_guide:           '수령위치',
  tracking_notify:             '운송장',
  chat_unanswered:             '미답변',
  identity_request:            '본인증명',
  contract_sent:               '전자계약',
  // 관리자 전용 이벤트(sendPushToAdmins) — 관리자 세션에서도 이 컴포넌트를 공유하므로 포함
  new_reservation:            '예약',
  payment_completed:          '결제',
  contract_signed:            '전자계약',
  new_session:                '상담',
}

/**
 * notifyType(payload.data.notifyType)을 3종 표준 문구 중 하나로 변환한다.
 * 매핑에 없는 타입(또는 값 없음)은 ①(신규 대화) 기본값으로 처리 — 신규 알림 타입을
 * 추가할 때 이 파일에 분류를 깜빡해도 화면이 깨지지 않고 안전하게 폴백된다.
 */
export function buildUnifiedPushToastMessage(notifyType: string | null | undefined): string {
  if (notifyType && ANSWER_NOTIFY_TYPES.has(notifyType)) {
    return '새로운 답변을 확인하세요.'
  }
  const label = notifyType ? IMPORTANT_NOTIFY_LABELS[notifyType] : undefined
  if (label) {
    return `새로운 ${label} 정보를 확인하세요.`
  }
  return '새로운 대화를 확인하세요.'
}
