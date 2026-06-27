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
  | 'reservation_approval'
  | 'payment_request'
  | 'shipment_notify'
  | 'return_remind'
  | 'coupon_issued'

export type ActionCardButtonColor = 'purple' | 'red' | 'green' | 'orange'

export interface ActionPayload {
  type: ActionCardType
  // 공통
  reservation_id?: string
  reservation_no?: string
  product_name?: string
  product_image?: string       // Cloudinary public_id
  button_label?: string
  button_color?: ActionCardButtonColor
  action_url?: string
  // PAYMENT_REQUEST_CARD
  amount?: number
  expires_at?: string          // ISO 8601
  // SHIPMENT_TRACKING_CARD
  tracking_number?: string
  carrier?: string
  carrier_url?: string
  // COUPON_GIFT_CARD
  coupon_code?: string
  discount_label?: string      // "20% 할인" / "5,000원 할인"
  // PRODUCT_CARD
  product_id?: string
  daily_rate?: number
  // RETURN_REGISTRATION_CARD
  return_deadline?: string     // ISO 8601
  return_methods?: string[]    // ['택배', '직접 방문']
  // 만료 처리
  is_expired?: boolean
}

export interface ChatSession {
  id: string
  user_id: string
  admin_id: string | null
  status: ChatSessionStatus
  context_type: ChatContextType
  context_id: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  // 조인 데이터 (클라이언트 렌더링용)
  user_name?: string
  user_handle?: string
  unread_count?: number
  last_message_content?: string
  last_message_sender?: string
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

export interface SendActionCardRequest {
  session_id: string
  action_payload: ActionPayload
  content?: string
}
