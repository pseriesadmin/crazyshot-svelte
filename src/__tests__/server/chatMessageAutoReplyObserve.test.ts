import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/chat/message — 자동답변 관찰 모드·판정 불가 시 대기 안내·반복 억제 (2026-10-06)
 *  · 관찰 모드(enabled=false, observe_mode=true): 판정을 평가·기록만 하고 고객에게 빠른답변을 보내지 않는다
 *  · enabled=true: 모델까지 통과한 답변만 발송, 못 통과하면 "관리자 답변 대기" 안내
 *  · 대기 안내는 같은 세션에서 5분 안에 반복하지 않는다(인텐트 로그·관리자 긴급 푸시는 유지)
 *  · 관찰 기록 실패는 채팅 응답을 깨지 않는다(fail-soft)
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

const mockSendPushToUser = vi.fn().mockResolvedValue(undefined)
const mockUrgentPush = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendPushToUser: (...a: unknown[]) => mockSendPushToUser(...a),
  sendUrgentChatAdminPush: (...a: unknown[]) => mockUrgentPush(...a),
  sendCustomerMessageAdminPush: vi.fn().mockResolvedValue(undefined),
}))

const mockDecide = vi.fn()
vi.mock('$lib/server/cannedAutoReply', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/cannedAutoReply')>('$lib/server/cannedAutoReply')
  return { ...actual, decideAutoReply: (...a: unknown[]) => mockDecide(...a) }
})

import { WAIT_REPLY } from '$lib/server/cannedAutoReply'

type Result = { data: unknown; error?: unknown }
interface Insert { table: string; row: Record<string, unknown> }
let inserts: Insert[]

function makeChain(table: string, single: Result, thenResult?: Result) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'gte']) chain[m] = vi.fn(() => chain)
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    inserts.push({ table, row })
    return chain
  })
  chain.single = vi.fn().mockResolvedValue(single)
  chain.maybeSingle = vi.fn().mockResolvedValue(single)
  chain.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(thenResult ?? single).then(resolve, reject)
  return chain
}

const USER_ID = 'customer-uid'
const SESSION_ID = 'session-1'
const CANNED = { id: 'canned-1', title: '보증금은 얼마인가요?', content: '보증금 제도는 없습니다', category: 'payment', shortcut: null, match_keywords: ['보증금'], usage_count: 0 }

interface Opts {
  enabled: boolean
  observe: boolean
  answer: typeof CANNED | null
  recentWait?: { id: string }[]
  observationInsertError?: { message: string; code: string }
}

let mockAdmin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
let mockDb: { from: ReturnType<typeof vi.fn> }

function setup(o: Opts) {
  inserts = []
  mockDecide.mockReturnValue({
    evaluation: {
      decision: o.answer ? 'answer' : 'no_match', best: o.answer, reason: o.answer ? 'ok' : 'below_threshold', tokenCount: 1,
      top: [{ id: 'canned-1', evidence: 2, coverage: 1, score: 6, passesRules: true, features: { evidence: 2, coverage: 1 } }],
    },
    verdict: { decision: o.answer ? 'answer' : 'wait', probability: o.answer ? 0.93 : null, bestId: o.answer ? 'canned-1' : null, reason: o.answer ? 'ok' : 'below_threshold' },
    answer: o.answer,
  })
  mockAdmin = {
    from: vi.fn((table: string) => {
      if (table === 'auto_reply_settings') return makeChain(table, { data: { enabled: o.enabled, observe_mode: o.observe } })
      if (table === 'canned_responses') return makeChain(table, { data: [CANNED] })
      if (table === 'chat_messages') return makeChain(table, { data: { id: 'new-msg-id' } }, { data: o.recentWait ?? [] })
      if (table === 'canned_match_observations') {
        return makeChain(table, { data: null }, { data: null, error: o.observationInsertError })
      }
      return makeChain(table, { data: null })
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  mockDb = {
    from: vi.fn((table: string) => {
      if (table === 'chat_sessions') {
        return makeChain(table, { data: { user_id: USER_ID, status: 'open', context_type: 'general', context_id: null, manual_mode: false, admin_id: null } })
      }
      // INSERT(.single)는 사용자 메시지 행, 대화 이력 조회(.then)는 빈 배열
      if (table === 'chat_messages') return makeChain(table, { data: { id: 'user-msg-id', session_id: SESSION_ID } }, { data: [] })
      return makeChain(table, { data: null })
    }),
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mockAdmin }))
const { POST } = await import('../../routes/api/chat/message/+server')

function event(content = '보증금이 얼마예요?') {
  return {
    request: { json: async () => ({ session_id: SESSION_ID, content }) },
    locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: USER_ID } } }), supabase: mockDb },
  } as unknown as Parameters<typeof POST>[0]
}
const run = async () => (await POST(event())) as unknown as { status: number; data: { ai_message: { content?: string } | null } }
const insertsOf = (table: string) => inserts.filter((i) => i.table === table).map((i) => i.row)

describe('관찰 모드(enabled=false, observe_mode=true)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('판정을 기록하지만 고객에게 빠른답변은 보내지 않고, 대기 안내가 나간다', async () => {
    setup({ enabled: false, observe: true, answer: CANNED })
    const res = await run()
    expect(res.status).toBe(201)
    expect(mockDecide).toHaveBeenCalledTimes(1)
    const obs = insertsOf('canned_match_observations')
    expect(obs).toHaveLength(1)
    expect(obs[0]).toMatchObject({ mode: 'observe', would_send: true, message_id: 'user-msg-id', model_decision: 'answer', best_canned_id: 'canned-1' })
    // 빠른답변(sender admin)은 발송되지 않았다
    expect(insertsOf('chat_messages').some((r) => r.sender_type === 'admin')).toBe(false)
    // 고객에게는 대기 안내(AI 폴백 문구)가 간다
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
  })

  it('관찰 기록에는 고객 질문 원문이 들어가지 않는다', async () => {
    setup({ enabled: false, observe: true, answer: CANNED })
    await run()
    expect(JSON.stringify(insertsOf('canned_match_observations')[0])).not.toContain('보증금이 얼마예요')
  })
})

describe('꺼짐(enabled=false, observe_mode=false) — 기존과 동일', () => {
  beforeEach(() => vi.clearAllMocks())
  it('판정도 기록도 하지 않고 대기 안내만 나간다', async () => {
    setup({ enabled: false, observe: false, answer: CANNED })
    await run()
    expect(mockDecide).not.toHaveBeenCalled()
    expect(insertsOf('canned_match_observations')).toHaveLength(0)
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
  })
})

describe('켜짐(enabled=true)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('모델까지 통과한 답변은 발송하고 mode=on으로 기록한다(대기 안내 없음)', async () => {
    setup({ enabled: true, observe: false, answer: CANNED })
    const res = await run()
    expect(res.status).toBe(201)
    expect(insertsOf('canned_match_observations')[0]).toMatchObject({ mode: 'on', would_send: true })
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'admin')?.content).toBe(CANNED.content)
    expect(insertsOf('chat_messages').some((r) => r.sender_type === 'ai')).toBe(false)
  })

  it('모델이 대기로 판정하면 빠른답변 대신 대기 안내', async () => {
    setup({ enabled: true, observe: false, answer: null })
    await run()
    expect(insertsOf('canned_match_observations')[0]).toMatchObject({ mode: 'on', would_send: false, model_decision: 'wait' })
    expect(insertsOf('chat_messages').some((r) => r.sender_type === 'admin')).toBe(false)
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
  })

  it('observe_mode도 함께 켜져 있어도 mode는 on이고 한 번만 기록된다', async () => {
    setup({ enabled: true, observe: true, answer: CANNED })
    await run()
    const obs = insertsOf('canned_match_observations')
    expect(obs).toHaveLength(1)
    expect(obs[0].mode).toBe('on')
  })
})

describe('대기 안내 반복 억제(5분)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5분 안에 같은 안내를 이미 보냈다면 다시 보내지 않는다(응답 ai_message=null, 고객 푸시 없음)', async () => {
    setup({ enabled: true, observe: false, answer: null, recentWait: [{ id: 'old-wait' }] })
    const res = await run()
    expect(res.status).toBe(201)
    expect(res.data.ai_message).toBeNull()
    expect(insertsOf('chat_messages').some((r) => r.sender_type === 'ai')).toBe(false)
    expect(mockSendPushToUser).not.toHaveBeenCalled()
    // 인텐트 로그(긴급 배지 근거)와 관리자 긴급 푸시는 유지된다
    expect(insertsOf('chat_intent_logs')).toHaveLength(1)
    expect(mockUrgentPush).toHaveBeenCalledTimes(1)
  })

  it('최근 안내가 없으면 보낸다(응답에 ai_message 포함, 고객 푸시 발송)', async () => {
    setup({ enabled: true, observe: false, answer: null, recentWait: [] })
    const res = await run()
    expect(res.data.ai_message).not.toBeNull()
    expect(mockSendPushToUser).toHaveBeenCalledTimes(1)
  })
})

describe('대기 안내 중복 조회 실패(fail-soft)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('조회가 예외를 던져도 억제하지 않고 안내를 보낸다(응답 201)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ enabled: true, observe: false, answer: null })
    // 기본 admin.from을 감싸 chat_messages의 select 체인에서만 예외를 던진다
    const baseFrom = mockAdmin.from.getMockImplementation() as ((table: string) => unknown) | undefined
    mockAdmin.from.mockImplementation((table: string) => {
      const chain = (baseFrom ? baseFrom(table) : {}) as Record<string, unknown>
      if (table === 'chat_messages') {
        chain.gte = vi.fn(() => { throw new Error('network down') })
      }
      return chain
    })
    const res = await run()
    expect(res.status).toBe(201)
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
    spy.mockRestore()
  })
})

describe('관찰 기록 실패는 채팅을 깨지 않는다(fail-soft)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('기록 INSERT 오류가 나도 응답은 정상(201)이고 대기 안내가 나간다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ enabled: false, observe: true, answer: CANNED, observationInsertError: { message: 'boom', code: 'XX000' } })
    const res = await run()
    expect(res.status).toBe(201)
    expect(insertsOf('chat_messages').find((r) => r.sender_type === 'ai')?.content).toBe(WAIT_REPLY)
    spy.mockRestore()
  })
  it('중복 기록(23505)은 조용히 무시한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ enabled: false, observe: true, answer: CANNED, observationInsertError: { message: 'dup', code: '23505' } })
    await run()
    // (AI 폴백 차단 상태 로그는 기존 동작이라 제외 — 관찰 기록 관련 로그만 확인)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('관찰 기록'))).toBe(false)
    spy.mockRestore()
  })
})
