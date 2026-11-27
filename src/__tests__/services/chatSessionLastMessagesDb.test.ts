/**
 * chatSessionLastMessagesDb.test.ts — Migration #856 (2026-11-27)
 * get_chat_session_last_messages: 세션별 '마지막으로 보이는 메시지'(admin_only 제외, 가장 최근 1건)만 돌려준다.
 * 기존 목록 조회는 모든 메시지를 한 번에 가져와 1,000건에서 잘렸다(Production 상위 100세션 메시지 1,999건 → 약 13개 세션 미리보기 공백).
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 시험. fixture 는 이 파일이 만들고 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const sessionIds: string[] = []
const userIds: string[] = []

afterEach(async () => {
  if (sessionIds.length) {
    await admin.from('chat_messages').delete().in('session_id', sessionIds)
    await admin.from('chat_sessions').delete().in('id', sessionIds)
    sessionIds.length = 0
  }
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => undefined)
  userIds.length = 0
}, 60000)

async function makeSession(): Promise<string> {
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `tdd-lastmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'Test1234!', email_confirm: true,
  })
  if (ue || !u.user) throw new Error(`사용자 생성 실패: ${ue?.message}`)
  userIds.push(u.user.id)
  const { data, error } = await admin.from('chat_sessions').insert({ user_id: u.user.id, status: 'open', context_type: 'general' }).select('id').single()
  if (error || !data) throw new Error(`세션 생성 실패: ${error?.message}`)
  sessionIds.push((data as { id: string }).id)
  return (data as { id: string }).id
}

async function addMsg(sessionId: string, content: string, at: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await admin.from('chat_messages').insert({ session_id: sessionId, sender_type: 'user', content, message_type: 'text', created_at: at, ...extra })
  if (error) throw new Error(`메시지 생성 실패: ${error.message}`)
}

type Row = { session_id: string; content: string | null; sender_type: string; created_at: string }
async function lastOf(ids: string[]): Promise<Row[]> {
  const { data, error } = await admin.rpc('get_chat_session_last_messages', { p_session_ids: ids })
  if (error) throw new Error(`RPC 오류: ${error.message}`)
  return (data ?? []) as Row[]
}

describe('[TDD] get_chat_session_last_messages (Migration 856)', () => {
  it('LM-1: 세션마다 가장 최근 메시지 1건만 돌려준다', async () => {
    const a = await makeSession(), b = await makeSession()
    await addMsg(a, 'a-old', '2031-01-01T00:00:00Z'); await addMsg(a, 'a-new', '2031-01-01T00:05:00Z')
    await addMsg(b, 'b-only', '2031-01-01T00:01:00Z')
    const rows = await lastOf([a, b])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.session_id === a)?.content).toBe('a-new')
    expect(rows.find((r) => r.session_id === b)?.content).toBe('b-only')
  })

  it('LM-2: admin_only 메시지는 건너뛰고 그 앞의 보이는 메시지를 돌려준다', async () => {
    const a = await makeSession()
    await addMsg(a, 'visible', '2031-01-01T00:00:00Z')
    await addMsg(a, 'warning-card', '2031-01-01T00:09:00Z', { admin_only: true })
    expect((await lastOf([a]))[0].content).toBe('visible')
  })

  it('LM-3: AI 자동응답도 마지막 메시지로 돌려준다(발신자 구분 포함)', async () => {
    const a = await makeSession()
    await addMsg(a, '질문', '2031-01-01T00:00:00Z')
    await addMsg(a, '[AI 자동응답💬]', '2031-01-01T00:00:03Z', { sender_type: 'ai' })
    const r = (await lastOf([a]))[0]
    expect(r.sender_type).toBe('ai')
  })

  it('LM-4: 메시지가 없는 세션은 결과에 없다', async () => {
    const a = await makeSession(), b = await makeSession()
    await addMsg(a, 'x', '2031-01-01T00:00:00Z')
    const rows = await lastOf([a, b])
    expect(rows.map((r) => r.session_id)).toEqual([a])
  })

  it('LM-5: 1,000건이 넘는 메시지가 있어도 모든 세션의 마지막 메시지를 돌려준다(상한 없음)', async () => {
    const old = await makeSession(), busy = await makeSession()
    await addMsg(old, 'old-last', '2031-01-01T00:00:00Z')
    const rows = Array.from({ length: 1005 }, (_, i) => ({
      session_id: busy, sender_type: 'user', content: `m${i}`, message_type: 'text',
      created_at: new Date(Date.UTC(2031, 1, 1, 0, 0, i)).toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await admin.from('chat_messages').insert(rows.slice(i, i + 250))
      if (error) throw new Error(`대량 생성 실패: ${error.message}`)
    }
    const res = await lastOf([old, busy])
    expect(res).toHaveLength(2)
    expect(res.find((r) => r.session_id === old)?.content).toBe('old-last')
    expect(res.find((r) => r.session_id === busy)?.content).toBe('m1004')
  }, 120000)

  it('LM-6: 일반 로그인 사용자(anon 키)는 호출할 수 없다(서버 전용)', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error } = await anon.rpc('get_chat_session_last_messages', { p_session_ids: [] })
    expect(error).not.toBeNull()
  })
})
