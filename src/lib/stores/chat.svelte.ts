// PRD.1.7 — 채팅 Svelte 5 Runes 스토어 (class 패턴)

import type { ChatSession, ChatMessage } from '$lib/types/chat'

class ChatStore {
  activeSessionId = $state<string | null>(null)
  messages = $state<ChatMessage[]>([])
  sessions = $state<ChatSession[]>([])
  unreadCount = $state<number>(0)
  isOpen = $state<boolean>(false)
  isSending = $state<boolean>(false)
  initialized = $state<boolean>(false)
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
}

export function toggleChat(): void {
  chatStore.isOpen = !chatStore.isOpen
}

export function setActiveSession(sessionId: string | null): void {
  chatStore.activeSessionId = sessionId
  if (sessionId === null) {
    chatStore.messages = []
  }
}

export function pushMessage(message: ChatMessage): void {
  // 중복 방지
  if (chatStore.messages.some((m) => m.id === message.id)) return
  chatStore.messages = [...chatStore.messages, message]

  // 본인 세션이 열려 있지 않은 경우 unread 증가
  if (!chatStore.isOpen && message.sender_type !== 'user') {
    chatStore.unreadCount += 1
  }
}

export function setMessages(messages: ChatMessage[]): void {
  chatStore.messages = messages
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
