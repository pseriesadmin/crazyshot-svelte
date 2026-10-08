/**
 * TDD: crazychatAiDb.test.ts — 크레이지챗 AI 폴백 실DB 검증 (Stage 전용, 모델 호출은 가짜)
 * 핵심: 관찰 모드는 기록만·켜짐 모드는 허용 분류만 발송 / 검수 안 된 정책 조각은 근거에서 제외 / 분당 상한 / 고객 키로는 기록·정책 테이블 접근 불가.
 * ⛔ Stage(ezyvffjvuwmtuhpxdjrw)에서만 실행. 설정 행은 끝에 전부 OFF로 복구한다.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import { runAiFallback, type ModelCaller } from '$lib/server/crazychat/ai-fallback'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.().catch(() => undefined) })
afterAll(async () => {
  if (isStage) await admin.from('crazychat_settings').update({
    agent_enabled: false, query_enabled: false, query_observe: false, action_enabled: false, action_observe: false,
    ai_fallback_enabled: false, ai_fallback_observe: false, ai_allowed_categories: [],
  }).eq('id', true)
})

const tag = () => `TDDAI${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const settings = (o: { enabled?: boolean; observe?: boolean; cats?: string[] }): CrazychatSettings => ({
  ...ALL_OFF, agentEnabled: true, aiFallback: { enabled: o.enabled ?? false, observe: o.observe ?? false }, aiAllowedCategories: o.cats ?? [],
})

async function setup(): Promise<{ userId: string; sessionId: string }> {
  const email = `tdd-crazychat-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const { data: sess, error: sErr } = await admin.from('chat_sessions').insert({ user_id: userId, status: 'open', context_type: 'general' }).select('id').single()
  if (sErr || !sess) throw new Error(`세션 생성 실패: ${sErr?.message}`)
  cleanups.push(async () => { await admin.from('chat_sessions').delete().eq('id', sess.id); await admin.auth.admin.deleteUser(userId) })
  return { userId, sessionId: sess.id as string }
}
async function userMsg(sessionId: string, content = '운영시간이 어떻게 되나요?'): Promise<string> {
  const { data, error } = await admin.from('chat_messages').insert({ session_id: sessionId, sender_type: 'user', content, message_type: 'text' }).select('id').single()
  if (error || !data) throw new Error(`메시지 생성 실패: ${error?.message}`)
  return data.id as string
}
async function snippet(title: string, content: string, category: string, reviewed: boolean): Promise<void> {
  const { data, error } = await admin.from('crazychat_policy_snippets')
    .insert({ title, content, category, reviewed, reviewed_at: reviewed ? new Date().toISOString() : null }).select('id').single()
  if (error || !data) throw new Error(`정책 조각 생성 실패: ${error?.message}`)
  cleanups.push(async () => { await admin.from('crazychat_policy_snippets').delete().eq('id', data.id) })
}
/** 프롬프트에서 제목에 맞는 근거 번호표를 찾아 그것을 인용하는 가짜 모델 */
const fakeModel = (title: string, answer: string): ModelCaller => vi.fn(async ({ system }) => {
  const m = new RegExp(`\\[(S\\d+)\\] ${title}`).exec(system)
  return { text: JSON.stringify({ decline: !m, answer: m ? answer : '', sources: m ? [m[1]] : [], confidence: 0.95 }), inputTokens: 100, outputTokens: 20 }
})

describe.skipIf(!isStage)('크레이지챗 AI 폴백 — 실DB', () => {
  it('관찰 모드: 호출 기록은 남고 고객 세션에는 아무 메시지도 생기지 않는다', async () => {
    const { userId, sessionId } = await setup()
    const t = tag()
    await snippet(t, '평일 10시부터 19시까지 운영합니다.', 'tddhours', true)
    const messageId = await userMsg(sessionId)
    const r = await runAiFallback(admin, { userId, sessionId, messageId, content: '운영시간이 어떻게 되나요?', adminEngaged: false },
      { settings: settings({ observe: true }), callModel: fakeModel(t, '평일 10시부터 19시까지 운영해요.') })
    expect(r).toEqual({ handled: false })
    const { data: obs } = await admin.from('ai_reply_observations').select('*').eq('message_id', messageId)
    expect(obs).toHaveLength(1)
    expect(obs![0]).toMatchObject({ mode: 'observe', outcome: 'answered', sent: false, category: 'tddhours', session_id: sessionId })
    const { data: msgs } = await admin.from('chat_messages').select('id').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(msgs).toHaveLength(0)
  })

  it('켜짐 모드: 허용 분류만 발송하고 기록에 sent=true', async () => {
    const { userId, sessionId } = await setup()
    const t = tag()
    await snippet(t, '평일 10시부터 19시까지 운영합니다.', 'tddhours', true)
    const messageId = await userMsg(sessionId)
    const r = await runAiFallback(admin, { userId, sessionId, messageId, content: '운영시간이 어떻게 되나요?', adminEngaged: false },
      { settings: settings({ enabled: true, cats: ['tddhours'] }), callModel: fakeModel(t, '평일 10시부터 19시까지 운영해요.') })
    expect(r.handled).toBe(true)
    const { data: msgs } = await admin.from('chat_messages').select('sender_type, content').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(msgs).toEqual([{ sender_type: 'ai', content: '평일 10시부터 19시까지 운영해요.' }])
    const { data: obs } = await admin.from('ai_reply_observations').select('sent, mode').eq('message_id', messageId)
    expect(obs).toEqual([{ sent: true, mode: 'on' }])
  })

  it('검수되지 않은 정책 조각은 근거에서 제외된다', async () => {
    const { userId, sessionId } = await setup()
    const t = tag()
    await snippet(t, '검수 전 내용 10시', 'tddhours', false)
    const messageId = await userMsg(sessionId)
    const call = fakeModel(t, '검수 전 내용')
    await runAiFallback(admin, { userId, sessionId, messageId, content: '운영시간이 어떻게 되나요?', adminEngaged: false }, { settings: settings({ observe: true }), callModel: call })
    const system = (call as unknown as { mock: { calls: Array<[{ system: string }]> } }).mock.calls[0]?.[0].system ?? ''
    expect(system).not.toContain(t)
    const { data: obs } = await admin.from('ai_reply_observations').select('outcome').eq('message_id', messageId)
    expect(obs).toEqual([{ outcome: 'declined' }])
  })

  it('최근 1분 안에 10회 호출 기록이 있으면 더 호출하지 않는다', async () => {
    const { userId, sessionId } = await setup()
    const t = tag()
    await snippet(t, '평일 10시부터 19시까지 운영합니다.', 'tddhours', true)
    for (let i = 0; i < 10; i++) {
      const { userId: u2, sessionId: s2 } = await setup()
      void u2
      const m = await userMsg(s2)
      await admin.from('ai_reply_observations').insert({ message_id: m, session_id: s2, mode: 'observe', outcome: 'answered', source_count: 1 })
    }
    const messageId = await userMsg(sessionId)
    const call = fakeModel(t, '평일 10시부터 19시까지 운영해요.')
    const r = await runAiFallback(admin, { userId, sessionId, messageId, content: '운영시간이 어떻게 되나요?', adminEngaged: false }, { settings: settings({ observe: true }), callModel: call })
    expect(r).toEqual({ handled: false })
    expect(call).not.toHaveBeenCalled()
  }, 60_000)

  it('고객·익명 키로는 기록·정책 테이블을 읽거나 쓸 수 없다', async () => {
    const anon: SupabaseClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    for (const table of ['ai_reply_observations', 'crazychat_policy_snippets']) {
      const sel = await anon.from(table).select('id').limit(1)
      expect(sel.data ?? []).toHaveLength(0)
      const ins = await anon.from(table).insert({ title: 'x', content: 'x', category: 'x' })
      expect(ins.error).not.toBeNull()
    }
  })

  it('DB 제약: 검수 완료 표시에는 검수 시각이 필요하고 초안은 600자까지', async () => {
    const bad = await admin.from('crazychat_policy_snippets').insert({ title: 'x', content: 'y', category: 'c', reviewed: true })
    expect(bad.error).not.toBeNull()
    const { sessionId } = await setup()
    const m = await userMsg(sessionId)
    const long = await admin.from('ai_reply_observations').insert({ message_id: m, session_id: sessionId, mode: 'on', outcome: 'answered', draft_text: 'a'.repeat(601) })
    expect(long.error).not.toBeNull()
  })
})
