// PRD.1.7 — 채팅 서비스 레이어
// Supabase Realtime + API 라우트 래퍼

import { supabase } from '$lib/services/supabase'
import type {
  ChatSession,
  ChatMessage,
  CreateSessionRequest,
  SendMessageRequest,
  SendMessageResponse,
  SendActionCardRequest,
  ActionPayload,
} from '$lib/types/chat'

// ──────────────────────────────────────────────
// 세션 관리
// ──────────────────────────────────────────────

export async function createChatSession(
  req: CreateSessionRequest = {}
): Promise<{ session: ChatSession | null; error: string | null }> {
  const res = await fetch('/api/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { session: null, error }
  }
  const { session } = await res.json()
  return { session, error: null }
}

export async function loadSession(
  sessionId: string
): Promise<{ session: ChatSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error) return { session: null, error: error.message }
  return { session: data as ChatSession, error: null }
}

export async function loadUserSession(
  contextType?: string,
  contextId?: string
): Promise<{ session: ChatSession | null; error: string | null }> {
  // open/pending 우선, 없으면 closed도 포함 (재활성화 흐름)
  let query = supabase
    .from('chat_sessions')
    .select('*')
    .in('status', ['open', 'pending', 'closed'])
    .order('updated_at', { ascending: false })
    .limit(1)

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (contextType) query = query.eq('context_type', contextType)
  if (contextId && UUID_RE.test(contextId)) query = query.eq('context_id', contextId)

  const { data, error } = await query.maybeSingle()
  if (error) return { session: null, error: error.message }
  return { session: data as ChatSession | null, error: null }
}

export async function closeChatSession(
  sessionId: string
): Promise<{ error: string | null }> {
  const res = await fetch('/api/chat/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { error }
  }
  return { error: null }
}

// ──────────────────────────────────────────────
// 메시지 조회
// ──────────────────────────────────────────────

export async function loadMessages(
  sessionId: string
): Promise<{ messages: ChatMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) return { messages: [], error: error.message }
  return { messages: (data as ChatMessage[]) ?? [], error: null }
}

// ──────────────────────────────────────────────
// 메시지 전송 (+ Claude AI 의도 분류)
// PRD.1.7.4 — /api/chat/message POST 경유
// ──────────────────────────────────────────────

export async function sendMessage(
  req: SendMessageRequest
): Promise<{ response: SendMessageResponse | null; error: string | null }> {
  const res = await fetch('/api/chat/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { response: null, error }
  }
  const response = await res.json()
  return { response, error: null }
}

// ──────────────────────────────────────────────
// 관리자: 액션 카드 수동 발송 (PRD.1.7.5)
// ──────────────────────────────────────────────

export async function sendActionCard(
  req: SendActionCardRequest
): Promise<{ message: ChatMessage | null; error: string | null }> {
  const res = await fetch('/api/chat/action-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { message: null, error }
  }
  const { message } = await res.json()
  return { message, error: null }
}

// ──────────────────────────────────────────────
// 첨부파일 메시지 전송
// ──────────────────────────────────────────────

export async function sendAttachment(params: {
  session_id: string
  file_name: string
  file_url: string
  is_image: boolean
}): Promise<{ message: import('$lib/types/chat').ChatMessage | null; error: string | null }> {
  const res = await fetch('/api/chat/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { message: null, error }
  }
  const { message } = await res.json()
  return { message, error: null }
}

// ──────────────────────────────────────────────
// 메시지 삭제 (사용자 첨부 메시지)
// ──────────────────────────────────────────────

export async function deleteMessage(messageId: string): Promise<{ error: string | null }> {
  const res = await fetch(`/api/chat/message/${messageId}`, { method: 'DELETE' })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { error }
  }
  return { error: null }
}

// ──────────────────────────────────────────────
// 읽음 처리
// ──────────────────────────────────────────────

// senderTypes: 읽음 처리할 발신자 타입 (기본: 상대방 메시지만)
// 사용자 측 → ['admin', 'ai'] / 관리자 측 → ['user']
export async function markMessagesRead(
  sessionId: string,
  senderTypes: ('user' | 'admin' | 'ai')[] = ['admin', 'ai']
): Promise<{ error: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('chat_messages')
    .update({ is_read: true })
    .eq('session_id', sessionId)
    .eq('is_read', false)
    .in('sender_type', senderTypes)

  return { error: (error as { message?: string } | null)?.message ?? null }
}

// ──────────────────────────────────────────────
// Realtime 구독 — PRD.1.7.6
// ──────────────────────────────────────────────

// 채널명 충돌 방지: 매 호출마다 고유 ID를 부여
// Supabase JS는 동일한 채널명이 이미 subscribed 상태이면 그 객체를 반환,
// 이후 .on() 호출 시 "cannot add callbacks after subscribe()" 에러 발생
let _channelSeq = 0

export function subscribeToChatMessages(
  sessionId: string,
  onMessage: (message: ChatMessage) => void,
  onRead?: (messageId: string) => void
): () => void {
  const uid = ++_channelSeq
  const channel = supabase
    .channel(`chat:${sessionId}:${uid}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        onMessage(payload.new as ChatMessage)
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        // 상대가 읽어서 is_read가 false → true 로 변경된 경우만
        if (payload.new.is_read === true && payload.old?.is_read === false) {
          onRead?.(payload.new.id as string)
        }
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// 관리자: 전체 세션 목록 Realtime 구독
// DELETE 이벤트는 payload.new가 빈 객체 → INSERT/UPDATE만 처리
export function subscribeToSessions(
  onUpdate: (session: ChatSession) => void
): () => void {
  const handlePayload = (payload: { new: unknown }) => {
    const s = payload.new as ChatSession
    if (s?.id) onUpdate(s)
  }

  const channel = supabase
    .channel('chat:sessions')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_sessions' }, handlePayload)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions' }, handlePayload)
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// ──────────────────────────────────────────────
// 관리자: 세션 목록 조회
// ──────────────────────────────────────────────

export async function loadAdminSessions(
  status?: string
): Promise<{ sessions: ChatSession[]; error: string | null }> {
  const url = status ? `/api/chat/sessions?status=${status}` : '/api/chat/sessions'
  const res = await fetch(url)
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Network error' }))
    return { sessions: [], error }
  }
  const { sessions } = await res.json()
  return { sessions: sessions ?? [], error: null }
}
