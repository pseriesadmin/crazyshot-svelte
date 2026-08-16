// PRD.1.7 — 대화형 렌탈예약 어시스턴트 시스템 V1.0

export type ChatSessionStatus = 'open' | 'pending' | 'closed'
export type ChatContextType = 'general' | 'product_inquiry' | 'reservation' | 'payment' | 'return'
export type ChatSenderType = 'user' | 'admin' | 'ai'
export type ChatMessageType = 'text' | 'action_card' | 'image' | 'system'
export type CsRecordStatus = 'new' | 'in_progress' | 'resolved'

// PRD.1.7.5 — 액션 카드 6종
export type ActionCardType =
  | 'PRODUCT_CARD'
  | 'RESERVATION_STATUS_CARD'
  | 'PAYMENT_REQUEST_CARD'
  | 'RETURN_REGISTRATION_CARD'
  | 'SHIPMENT_TRACKING_CARD'
  | 'COUPON_GIFT_CARD'
  // 관리자 발행 액션
  | 'identity_request'
  | 'reservation_hold'      // 예약 신청 접수 알림 (고객 수신)
  | 'reservation_approval'
  | 'payment_request'
  | 'shipment_notify'
  | 'rental_confirm'        // 대여확인(수령확인) 알림 (고객 수신)
  | 'return_remind'
  | 'coupon_issued'
  | 'contract_link'    // 전자계약 서명 링크 발송 (고객 수신)
  | 'contract_signed'  // 전자계약 서명 완료 알림 (관리자 수신)
  // 자동답변 메타데이터 (message_type: 'text', sender_type: 'admin')
  | 'auto_canned_reply'   // 빠른답변 자동매칭 성공 (하이브리드 1단계, AI 호출 전)
  // GSD-17: 관리자 @ 멘션 상품 카드 / GSD-20: 이미지·CTA 있는 자동응답 카드
  | 'product_link'
  | 'canned_cta'

export type ActionCardButtonColor = 'purple' | 'red' | 'green' | 'orange'

export interface ActionPayload {
  type: ActionCardType
  // 공통
  reservation_id?: string
  reservation_no?: string
  product_name?: string
  // RESERVATION_STATUS_CARD — "YYYY-MM-DD ~ YYYY-MM-DD" 형식 대여기간 표시용
  rental_period?: string
  product_image?: string       // Cloudinary public_id
  button_label?: string
  button_color?: ActionCardButtonColor
  action_url?: string
  // PAYMENT_REQUEST_CARD
  amount?: number
  expires_at?: string          // ISO 8601
  // PAYMENT_REQUEST_CARD — 연체료 결제 전용 (late_fees 테이블 기반)
  late_fee_id?: string         // late_fees.id (UUID)
  fee_amount?: number          // 연체료 금액 (원)
  hours_late?: number          // 연체 시간 (정수)
  // SHIPMENT_TRACKING_CARD
  tracking_number?: string
  carrier?: string
  carrier_url?: string
  // COUPON_GIFT_CARD
  coupon_code?: string
  discount_label?: string      // "20% 할인" / "5,000원 할인"
  coupon_id?: string           // 발급 대상 쿠폰 UUID (승인 전 대기 단계에서 사용)
  approval_status?: 'pending' | 'approved' | 'rejected'  // 관리자 승인 대기 상태
  // PRODUCT_CARD
  product_id?: string
  // product_link 카드 (GSD-17: 관리자 @ 멘션 삽입) — PRODUCT_CARD(AI 추천)도 공유
  product_slug?: string
  product_price?: number  // 24시간 기준 가격 (원)
  // RETURN_REGISTRATION_CARD
  return_deadline?: string     // ISO 8601
  return_methods?: string[]    // ['택배', '직접 방문']
  // reservation_approval 통합 카드(Migration 275) — 체크아웃 배치로 2건 이상 동시 승인 시
  // 상품별 개별 카드 대신 하나의 카드 안에 항목 목록으로 표시(items.length > 1일 때만 사용)
  items?: Array<{ reservation_no: string; product_name: string; return_deadline?: string }>
  // 만료 처리
  is_expired?: boolean
  // 자동답변 전용
  canned_response_id?: string
}

export interface ChatSession {
  id: string
  user_id: string
  admin_id: string | null
  status: ChatSessionStatus
  context_type: ChatContextType
  context_id: string | null
  // context_type='reservation' 전용 — context_id(uuid)로는 rental_reservations.id(bigint)를
  // 담을 수 없어 신설된 전용 컬럼(Migration 279)
  context_reservation_id: number | null
  created_at: string
  updated_at: string
  closed_at: string | null
  // 조인 데이터 (클라이언트 렌더링용)
  user_name?: string
  user_handle?: string
  unread_count?: number
  last_message_content?: string
  last_message_sender?: string
  is_urgent?: boolean  // 마지막 고객 메시지가 CS_ESCALATE로 분류되고 이후 관리자 응답이 없는 경우
  manual_mode?: boolean  // GSD-8: true면 이 세션의 자동응답(AI+캔드) 스킵 (마이그레이션 230)
}

export interface ChatMessage {
  id: string
  session_id: string
  sender_type: ChatSenderType
  content: string | null
  message_type: ChatMessageType
  action_payload: ActionPayload | null
  is_read: boolean
  created_at: string
  is_bookmarked?: boolean  // GSD-12: 관리자 북마크 여부 — 클라이언트 집계 시 병합
}

export interface ChatIntentLog {
  id: string
  message_id: string
  intent: ChatIntent
  confidence: number
  raw_response: Record<string, unknown> | null
  processed_at: string
}

export interface CsRecord {
  id: string
  session_id: string
  user_id: string
  category: string | null
  status: CsRecordStatus
  summary: string | null
  admin_note: string | null
  created_at: string
  updated_at: string
}

// PRD.1.7.4 — Claude AI 의도 분류
export type ChatIntent =
  | 'RESERVATION_INQUIRY'
  | 'PAYMENT_REQUEST'
  | 'RETURN_GUIDE'
  | 'PRODUCT_RECOMMEND'
  | 'CS_ESCALATE'
  | 'GENERAL'

export interface ChatIntentResponse {
  intent: ChatIntent
  confidence: number
  reply: string
  action_card?: ActionPayload
}

// API 요청/응답 타입
export interface CreateSessionRequest {
  context_type?: ChatContextType
  context_id?: string
  context_reservation_id?: number
}

export interface SendMessageRequest {
  session_id: string
  content: string
  message_type?: ChatMessageType
}

export interface SendMessageResponse {
  user_message: ChatMessage
  ai_message: ChatMessage | null
  intent_log: ChatIntentLog | null
}

