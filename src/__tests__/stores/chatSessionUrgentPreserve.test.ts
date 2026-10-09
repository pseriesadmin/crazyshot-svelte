import { describe, it, expect, beforeEach } from 'vitest'
import { chatStore, setSessions, upsertSession } from '$lib/stores/chat.svelte'
import type { ChatSession } from '$lib/types/chat'

/**
 * 관리자 상담 목록 Realtime 병합 — 긴급 배지(is_urgent) 보존 (2026-10-02)
 *
 * is_urgent는 /api/chat/sessions GET에서만 계산되는 파생값이다. Realtime UPDATE payload(chat_sessions raw row)에는
 * 없으므로, upsertSession이 보존하지 않으면 메시지·상태 전환마다 이미 뜬 긴급 배지가 꺼진다(service-operations.md §13).
 */

function session(over: Partial<ChatSession>): ChatSession {
  return {
    id: 's1',
    user_id: 'u1',
    status: 'open',
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    ...over,
  } as ChatSession
}

describe('upsertSession — is_urgent 보존', () => {
  beforeEach(() => {
    setSessions([session({ is_urgent: true, user_name: '홍길동', last_message_content: '파손됐어요' })])
  })

  it('Realtime UPDATE(raw row, is_urgent 없음)가 와도 긴급 배지와 클라이언트 전용 필드가 유지된다', () => {
    upsertSession(session({ updated_at: '2026-10-02T00:01:00.000Z' }))
    const s = chatStore.sessions.find((x) => x.id === 's1')
    expect(s?.is_urgent).toBe(true)
    expect(s?.user_name).toBe('홍길동')
    expect(s?.last_message_content).toBe('파손됐어요')
    expect(s?.updated_at).toBe('2026-10-02T00:01:00.000Z')
  })

  it('서버가 is_urgent를 명시해서 보내면(재조회 결과) 그 값이 우선한다', () => {
    upsertSession(session({ updated_at: '2026-10-02T00:02:00.000Z', is_urgent: false }))
    expect(chatStore.sessions.find((x) => x.id === 's1')?.is_urgent).toBe(false)
  })

  it('오래된 이벤트는 무시된다', () => {
    upsertSession(session({ updated_at: '2026-09-30T00:00:00.000Z', status: 'closed' }))
    expect(chatStore.sessions.find((x) => x.id === 's1')?.status).toBe('open')
  })
})

describe('upsertSession — user_blacklisted 보존(블랙리스트 배지, 2026-10-09)', () => {
  it('Realtime UPDATE(raw row)가 와도 블랙리스트 배지 값이 유지된다', () => {
    setSessions([session({ user_blacklisted: true })])
    upsertSession(session({ updated_at: '2026-10-02T00:01:00.000Z' }))
    expect(chatStore.sessions.find((x) => x.id === 's1')?.user_blacklisted).toBe(true)
  })
})
