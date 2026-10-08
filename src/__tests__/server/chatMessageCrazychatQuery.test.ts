import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/chat/message — 크레이지챗 연결(2026-10-07, S2 조회형 + S3 접수형 — 진입점 runCrazychatAgent)
 *  · 빠른답변이 답하면 조회형은 호출되지 않는다(빠른답변 우선)
 *  · 조회형이 처리하면 그 답변을 돌려주고 기존 AI/대기 안내 단계로 가지 않는다
 *  · 처리하지 못하면(꺼짐·대상 아님·실패) 기존 흐름(대기 안내)이 그대로 이어진다
 *  · 조회 대상 사용자는 세션 소유자(로그인 사용자)이며, 관리자 응대 여부·메시지 id가 정확히 전달된다
 *  · 수동응대(manual_mode) 세션에서는 호출되지 않는다
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$env/static/private', () => ({ ANTHROPIC_API_KEY: 'test-anthropic-key' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() } } }))
vi.mock('$lib/server/synonymLearning', () => ({ loadSynonymGroups: vi.fn().mockResolvedValue([]) }))
vi.mock('$lib/server/chatActionEnrich', () => ({ enrichActionCard: vi.fn().mockResolvedValue(null) }))
vi.mock('$lib/server/crossLingualSynonymScan', () => ({ registerCrossLingualCandidates: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/push', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  sendUrgentChatAdminPush: vi.fn().mockResolvedValue(undefined),
  sendCustomerMessageAdminPush: vi.fn().mockResolvedValue(undefined),
}))

const mockDecide = vi.fn()
vi.mock('$lib/server/cannedAutoReply', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/cannedAutoReply')>('$lib/server/cannedAutoReply')
  return { ...actual, decideAutoReply: (...a: unknown[]) => mockDecide(...a) }
})

const mockRunQuery = vi.fn()
vi.mock('$lib/server/crazychat/agent', () => ({ runCrazychatAgent: (...a: unknown[]) => mockRunQuery(...a) }))

import { WAIT_REPLY } from '$lib/server/cannedAutoReply'

type Result = { data: unknown; error?: unknown }
interface Insert { table: string; row: Record<string, unknown> }
let inserts: Insert[]

function makeChain(table: string, single: Result, thenResult?: Result) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'gte']) chain[m] = vi.fn(() => chain)
  chain.insert = vi.fn((row: Record<string, unknown>) => { inserts.push({ table, row }); return chain })
  chain.single = vi.fn().mockResolvedValue(single)
  chain.maybeSingle = vi.fn().mockResolvedValue(single)
  chain.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(thenResult ?? single).then(resolve, reject)
  return chain
}

const USER_ID = 'customer-uid'
const SESSION_ID = 'session-1'
const CANNED = { id: 'canned-1', title: '보증금은 얼마인가요?', content: '보증금 제도는 없습니다', category: 'payment', shortcut: null, match_keywords: ['보증금'], usage_count: 0 }

interface Opts { cannedEnabled?: boolean; cannedAnswer?: boolean; manual?: boolean; adminId?: string | null }
let mockAdmin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
let mockDb: { from: ReturnType<typeof vi.fn> }

function setup(o: Opts = {}) {
  inserts = []
  mockDecide.mockReturnValue({
    evaluation: { decision: o.cannedAnswer ? 'answer' : 'no_match', best: o.cannedAnswer ? CANNED : null, reason: 'x', tokenCount: 1, top: [] },
    verdict: { decision: o.cannedAnswer ? 'answer' : 'wait', probability: o.cannedAnswer ? 0.93 : null, bestId: null, reason: 'x' },
    answer: o.cannedAnswer ? CANNED : null,
  })
  mockAdmin = {
    from: vi.fn((table: string) => {
      if (table === 'auto_reply_settings') return makeChain(table, { data: { enabled: !!o.cannedEnabled, observe_mode: false } })
      if (table === 'canned_responses') return makeChain(table, { data: [CANNED] })
      if (table === 'chat_messages') return makeChain(table, { data: { id: 'new-msg-id' } }, { data: [] })
      return makeChain(table, { data: null })
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  mockDb = {
    from: vi.fn((table: string) => {
      if (table === 'chat_sessions') {
        return makeChain(table, { data: { user_id: USER_ID, status: 'open', context_type: 'general', context_id: null, manual_mode: !!o.manual, admin_id: o.adminId ?? null } })
      }
      if (table === 'chat_messages') return makeChain(table, { data: { id: 'user-msg-id', session_id: SESSION_ID } }, { data: [] })
      return makeChain(table, { data: null })
    }),
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mockAdmin }))
const { POST } = await import('../../routes/api/chat/message/+server')

function event(content = '내 예약 상태 확인해줘') {
  return {
    request: { json: async () => ({ session_id: SESSION_ID, content }) },
    locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: USER_ID } } }), supabase: mockDb },
  } as unknown as Parameters<typeof POST>[0]
}
type Res = { status: number; data: { ai_message: { content?: string } | null; user_message: unknown } }
const run = async (content?: string) => (await POST(event(content))) as unknown as Res
const insertsOf = (table: string) => inserts.filter((i) => i.table === table).map((i) => i.row)

describe('크레이지챗 연결', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('조회형이 처리하면 그 답변을 돌려주고 대기 안내는 저장하지 않는다', async () => {
    setup()
    const aiMessage = { id: 'ai-1', sender_type: 'ai', content: '예약 CS2610001: 현재 계약 완료 상태예요.' }
    mockRunQuery.mockResolvedValue({ handled: true, aiMessage })
    const res = await run()
    expect(res.status).toBe(201)
    expect(res.data.ai_message).toEqual(aiMessage)
    expect(insertsOf('chat_messages').some((r) => r.sender_type === 'ai')).toBe(false)
  })

  it('조회형이 처리하지 못하면 기존 흐름(대기 안내)이 그대로 이어진다', async () => {
    setup()
    mockRunQuery.mockResolvedValue({ handled: false })
    const res = await run()
    expect(res.status).toBe(201)
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
  })

  it('조회형에 전달되는 사용자는 로그인 사용자(세션 소유자), 메시지 id·관리자 응대 여부가 정확하다', async () => {
    setup({ adminId: null })
    mockRunQuery.mockResolvedValue({ handled: false })
    await run('서류 승인됐나요?')
    expect(mockRunQuery).toHaveBeenCalledTimes(1)
    const [, ctx] = mockRunQuery.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctx).toEqual({ userId: USER_ID, sessionId: SESSION_ID, messageId: 'user-msg-id', content: '서류 승인됐나요?', adminEngaged: false })
  })

  it('관리자가 이미 응대한 세션이면 adminEngaged=true로 전달한다', async () => {
    setup({ adminId: 'admin-uid' })
    mockRunQuery.mockResolvedValue({ handled: false })
    await run()
    const [, ctx] = mockRunQuery.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctx.adminEngaged).toBe(true)
  })

  it('빠른답변이 답하면 조회형은 호출되지 않는다(빠른답변 우선)', async () => {
    setup({ cannedEnabled: true, cannedAnswer: true })
    const res = await run('보증금이 얼마예요?')
    expect(res.status).toBe(201)
    expect(mockRunQuery).not.toHaveBeenCalled()
  })

  it('수동응대(manual_mode) 세션에서는 조회형을 호출하지 않는다', async () => {
    setup({ manual: true })
    const res = await run()
    expect(res.status).toBe(201)
    expect(mockRunQuery).not.toHaveBeenCalled()
  })
})
