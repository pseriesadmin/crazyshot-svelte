/**
 * 대화카드(action_payload.type) → SMS 발송 알림 타입(sms_notification_logs.notify_type) 매핑.
 *
 * send_rental_chat_notification RPC는 notify_type을 그대로 카드 type으로 저장하지 않는다
 * (return_registration → RETURN_REGISTRATION_CARD, reservation_cancelled·dhero_place_guide 등 →
 * RESERVATION_STATUS_CARD). 관리자 카드의 "SMS 발송 성공." 표시는 이 매핑으로 어떤 notify_type의
 * SMS 로그를 볼지 정한다(2026-10-02). SMS 대상 notify_type 목록은 sms.ts LIFECYCLE_SMS_COPY와
 * 항상 함께 갱신할 것(service-operations.md §15 3축 동기화).
 */
const DIRECT_TYPES = [
  'contract_link',
  'contract_signed',
  'reservation_approval',
  'shipment_notify',
  'tracking_notify',
  'return_remind',
] as const

export function smsNotifyTypesForCard(cardType: string | null | undefined): string[] {
  if (!cardType) return []
  if ((DIRECT_TYPES as readonly string[]).includes(cardType)) return [cardType]
  if (cardType === 'RETURN_REGISTRATION_CARD') return ['return_registration']
  // RESERVATION_STATUS_CARD는 여러 notify_type이 공유 — SMS 대상인 것만 후보로 본다
  if (cardType === 'RESERVATION_STATUS_CARD') return ['reservation_cancelled', 'dhero_place_guide']
  return []
}
