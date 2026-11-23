// 대기 안내(30분 무응답)의 대화창 메시지 (2026-11-16)
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { postUnansweredChatNotice, UNANSWERED_DEFAULT_MESSAGE } from '$lib/server/unansweredNotice'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

interface Rec { inserts: { session_id: string; content: string; sender_type: string }[]; updates: number }

function fakeAdmin(opts: { pushEnabled?: boolean; message?: string | null; sessions?: string[] }, rec: Rec): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'push_notification_config') {
        return {
          select: (cols: string) =>
            cols.includes('extra_config')
              ? Promise.resolve({ data: [{ notify_type: 'chat_unanswered', extra_config: opts.message ? { message: opts.message } : {} }], error: null })
              : { eq: () => ({ maybeSingle: async () => ({ data: { push_enabled: opts.pushEnabled ?? true }, error: null }) }) },
        }
      }
      if (table === 'chat_sessions') {
        return {
          select: () => ({ eq: () => ({ gte: async () => ({ data: (opts.sessions ?? []).map((id) => ({ id })), error: null }) }) }),
          update: () => ({ eq: async () => { rec.updates++; return { error: null } } }),
        }
      }
      if (table === 'chat_messages') {
        return { insert: async (row: { session_id: string; content: string; sender_type: string }) => { rec.inserts.push(row); return { error: null } } }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: '홍길동' }, error: null }) }) }) }
    },
  } as unknown as SupabaseClient
}

describe('postUnansweredChatNotice', () => {
  let rec: Rec
  beforeEach(() => { clearNotifyMessageCache(); rec = { inserts: [], updates: 0 } })

  it('설정 문구가 있으면 그 문장으로 대화창에 자동응답 메시지를 남긴다', async () => {
    await postUnansweredChatNotice(fakeAdmin({ message: '[자동응답💬]\n답변이 지연되어 죄송합니다.', sessions: ['s1'] }, rec), 'u1', '2026-11-16T00:00:00Z')
    expect(rec.inserts).toEqual([{ session_id: 's1', sender_type: 'ai', content: '[자동응답💬]\n답변이 지연되어 죄송합니다.', message_type: 'text' }])
    expect(rec.updates).toBe(1)
  })
  it('설정 문구가 없으면 푸시 기본 문구', async () => {
    await postUnansweredChatNotice(fakeAdmin({ sessions: ['s1'] }, rec), 'u1', '2026-11-16T00:00:00Z')
    expect(rec.inserts[0]?.content).toBe(UNANSWERED_DEFAULT_MESSAGE)
  })
  it('알림을 꺼 둔 상태면 대화창 메시지도 보내지 않는다', async () => {
    await postUnansweredChatNotice(fakeAdmin({ pushEnabled: false, sessions: ['s1'] }, rec), 'u1', '2026-11-16T00:00:00Z')
    expect(rec.inserts).toHaveLength(0)
  })
  it('방금 표시된 세션이 없으면 보내지 않는다', async () => {
    await postUnansweredChatNotice(fakeAdmin({ sessions: [] }, rec), 'u1', '2026-11-16T00:00:00Z')
    expect(rec.inserts).toHaveLength(0)
  })
  it('세션이 여러 개면 각각 한 번씩', async () => {
    await postUnansweredChatNotice(fakeAdmin({ sessions: ['s1', 's2'] }, rec), 'u1', '2026-11-16T00:00:00Z')
    expect(rec.inserts.map((r) => r.session_id)).toEqual(['s1', 's2'])
  })
})

describe('세션 목록 라우트 배선(소스 가드)', () => {
  const src = readFileSync('src/routes/api/chat/sessions/+server.ts', 'utf8')
  it('푸시와 함께 대화창 안내를 남긴다', () => {
    expect(src).toContain('postUnansweredChatNotice(admin, userId, markedSince)')
  })
  it('같은 고객의 세션이 여러 개여도 고객당 한 번만 보낸다(user_id 중복 제거)', () => {
    expect(src).toContain('new Set(userIds.map((row) => row.user_id))')
  })
})
