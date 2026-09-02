// PRD.1.7 — 채팅 Svelte 5 Runes 스토어 (class 패턴)

import type { ChatSession, ChatMessage } from '$lib/types/chat'

// 공통 플로팅 채팅 모달을 다른 화면(예: /account/rental 카드별 문의 버튼)에서
// 특정 컨텍스트로 호출할 때 사용 — ChatWindow가 props보다 이 값을 우선 사용한다.
export interface ChatContextOverride {
  context_type?: string
  context_id?: string
  context_reservation_id?: number
}

class ChatStore {
  activeSessionId = $state<string | null>(null)
  messages = $state<ChatMessage[]>([])
  sessions = $state<ChatSession[]>([])
  unreadCount = $state<number>(0)
  isOpen = $state<boolean>(false)
  isSending = $state<boolean>(false)
  initialized = $state<boolean>(false)
  // 메시지 페이지네이션(2026-08-15 확정: 최초 20개 + 위로 스크롤 시 이전 페이지 추가로딩)
  hasMoreOlderMessages = $state<boolean>(false)
  isLoadingOlderMessages = $state<boolean>(false)
  contextOverride = $state<ChatContextOverride | null>(null)
}

export const chatStore = new ChatStore()

// ──────────────────────────────────────────────
// 액션
// ──────────────────────────────────────────────

export function openChat(): void {
  chatStore.isOpen = true
}

export function closeChat(): void {
  chatStore.isOpen = false
  // 컨텍스트 지정으로 열렸던 상담을 닫으면 다음 번 전역 FAB 클릭은 기본(일반) 상담으로 복귀
  chatStore.contextOverride = null
}

export function toggleChat(): void {
  chatStore.isOpen = !chatStore.isOpen
  if (!chatStore.isOpen) chatStore.contextOverride = null
}

// 다른 화면에서 공통 플로팅 채팅 모달을 특정 컨텍스트(예: 대여 건)로 열 때 사용
export function openChatWithContext(ctx: ChatContextOverride): void {
  chatStore.contextOverride = ctx
  chatStore.activeSessionId = null
  chatStore.messages = []
  chatStore.isOpen = true
}

export function setActiveSession(sessionId: string | null): void {
  chatStore.activeSessionId = sessionId
  chatStore.hasMoreOlderMessages = false
  chatStore.isLoadingOlderMessages = false
  if (sessionId === null) {
    chatStore.messages = []
  }
}

export function pushMessage(message: ChatMessage): void {
  // 중복 방지
  if (chatStore.messages.some((m) => m.id === message.id)) return

  // 낙관적 임시 메시지(ChatWindow.handleSend가 만드는 `temp-<uuid>`) 치환 —
  // Supabase Realtime이 서버 POST 응답보다 먼저 같은 사용자 메시지의 INSERT를 통지하는
  // 경쟁 상황(캔드매칭/AI 폴백 처리로 응답이 지연될수록 자주 발생)에서, 실제 메시지를
  // 임시 메시지 옆에 추가하지 않고 그 자리에서 교체한다. 그대로 추가하면 "말풍선이 잠깐
  // 중복 노출됐다가 POST 완료 시 removeMessage(tempId)로 하나만 사라지는" 것처럼 보이는
  // 실서비스 결함으로 이어졌다(2026-09-02 발견·수정).
  if (message.sender_type === 'user' && !message.id.startsWith('temp-')) {
    const tempIdx = chatStore.messages.findIndex(
      (m) =>
        m.id.startsWith('temp-') &&
        m.session_id === message.session_id &&
        m.sender_type === 'user' &&
        m.content === message.content
    )
    if (tempIdx !== -1) {
      chatStore.messages = [
        ...chatStore.messages.slice(0, tempIdx),
        message,
        ...chatStore.messages.slice(tempIdx + 1),
      ]
      return
    }
  }

  chatStore.messages = [...chatStore.messages, message]

  // 본인 세션이 열려 있지 않은 경우 unread 증가
  if (!chatStore.isOpen && message.sender_type !== 'user') {
    chatStore.unreadCount += 1
  }
}

export function setMessages(messages: ChatMessage[]): void {
  chatStore.messages = messages
}

// 위로 스크롤해 불러온 이전 페이지를 현재 목록 앞에 병합(중복 방지)
export function prependMessages(older: ChatMessage[]): void {
  const existingIds = new Set(chatStore.messages.map((m) => m.id))
  const fresh = older.filter((m) => !existingIds.has(m.id))
  if (fresh.length > 0) chatStore.messages = [...fresh, ...chatStore.messages]
}

export function setSessions(sessions: ChatSession[]): void {
  chatStore.sessions = sessions
  chatStore.unreadCount = sessions.reduce((acc, s) => acc + (s.unread_count ?? 0), 0)
}

export function removeMessage(messageId: string): void {
  chatStore.messages = chatStore.messages.filter((m) => m.id !== messageId)
}

// 상대방이 읽었을 때 is_read 로컬 반영
export function markMessageRead(messageId: string): void {
  chatStore.messages = chatStore.messages.map((m) =>
    m.id === messageId ? { ...m, is_read: true } : m
  )
}

// 세션 내 특정 sender_type 메시지 전체 읽음 처리
export function markAllRead(senderType: 'user' | 'ai' | 'admin'): void {
  chatStore.messages = chatStore.messages.map((m) =>
    m.sender_type === senderType ? { ...m, is_read: true } : m
  )
}

export function resetUnreadCount(): void {
  chatStore.unreadCount = 0
}

// 새 메시지 도착 시 세션 목록의 마지막 메시지 미리보기 갱신 + 최신순 재정렬(맨 위로)
export function applyIncomingMessagePreview(message: ChatMessage): void {
  const idx = chatStore.sessions.findIndex((s) => s.id === message.session_id)
  if (idx < 0) return

  const existing = chatStore.sessions[idx]
  const updated: ChatSession = {
    ...existing,
    last_message_content: message.content ?? existing.last_message_content,
    last_message_sender: message.sender_type,
    updated_at: message.created_at ?? existing.updated_at,
  }

  chatStore.sessions = [
    updated,
    ...chatStore.sessions.filter((s) => s.id !== message.session_id),
  ]
}

export function upsertSession(session: ChatSession): void {
  // DELETE 이벤트 방어: id 없는 페이로드 무시
  if (!session?.id) return

  const idx = chatStore.sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) {
    const existing = chatStore.sessions[idx]
    // 오래된 Realtime 이벤트가 신선한 데이터를 덮어쓰지 않도록 updated_at 비교
    if (session.updated_at < (existing.updated_at ?? '')) return

    chatStore.sessions = [
      ...chatStore.sessions.slice(0, idx),
      {
        // 클라이언트 전용 필드(API 배치쿼리 결과) 항상 보존
        last_message_content: existing.last_message_content,
        last_message_sender: existing.last_message_sender,
        user_name: existing.user_name,
        user_handle: existing.user_handle,
        unread_count: existing.unread_count,
        ...session,
      },
      ...chatStore.sessions.slice(idx + 1),
    ]
  } else {
    chatStore.sessions = [session, ...chatStore.sessions]
  }
}
