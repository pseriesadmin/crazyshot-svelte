import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/chat/message — '파손' 캔드응답 매칭 시 "파손신고접수" 액션카드 발송 회귀 테스트
 * (2026-09-08, Stephen 지시: 고객 채팅에서 '상품 파손' 대화 감지 시 파손신고접수 카드 노출)
 *
 * 예약의 실제 status는 이 시점에 전환되지 않는다 — 관리자가 대화를 확인한 뒤
 * CMS "파손 신고 접수 처리" 버튼으로 직접 damage_claimed 전환한다(자동전환 아님).
 * 이 테스트는 카드 발송 트리거 조건(활성 예약 존재 여부·캔드 카테고리)만 검증한다.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}))

vi.mock('$env/static/private', () => ({
  ANTHROPIC_API_KEY: 'test-anthropic-key',
}))

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() }
  },
}))

const mockMatchCannedResponse = vi.fn()
vi.mock('$lib/server/matchCannedResponse', () => ({
  matchCannedResponse: (...args: unknown[]) => mockMatchCannedResponse(...args),
}))

vi.mock('$lib/server/synonymLearning', () => ({
  loadSynonymGroups: vi.fn().mockResolvedValue([]),
}))

vi.mock('$lib/server/chatActionEnrich', () => ({
  enrichActionCard: vi.fn().mockResolvedValue(null),
}))

vi.mock('$lib/server/crossLingualSynonymScan', () => ({
  registerCrossLingualCandidates: vi.fn().mockResolvedValue(undefined),
}))

const mockSendPushToUser = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
}))

type TableResult = { data: unknown; error?: unknown }

function makeChain(result: TableResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (resolve: (v: TableResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

const USER_ID = 'customer-uid'
const SESSION_ID = 'session-1'

let mockAdmin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
let mockDb: { from: ReturnType<typeof vi.fn> }
let rpcCalls: Array<{ name: string; args: unknown }>

function setup(opts: {
  cannedMatch: { id: string; content: string; category?: string } | null
  activeReservationId: number | null
}) {
  rpcCalls = []
  mockMatchCannedResponse.mockReturnValue(opts.cannedMatch)

  mockAdmin = {
    from: vi.fn((table: string) => {
      if (table === 'auto_reply_settings') return makeChain({ data: { enabled: true } })
      if (table === 'canned_responses') return makeChain({ data: [{ id: 'canned-1', category: 'damage' }] })
      if (table === 'rental_reservations') {
        return makeChain({
          data: opts.activeReservationId ? { id: opts.activeReservationId } : null,
        })
      }
      if (table === 'chat_messages') {
        return makeChain({ data: { id: 'matched-msg-id', session_id: SESSION_ID } })
      }
      if (table === 'chat_intent_logs') return makeChain({ data: null })
      if (table === 'chat_sessions') return makeChain({ data: null })
      return makeChain({ data: null })
    }),
    rpc: vi.fn((name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    }),
  }

  mockDb = {
    from: vi.fn((table: string) => {
      if (table === 'chat_sessions') {
        return makeChain({
          data: { user_id: USER_ID, status: 'open', context_type: 'general', context_id: null, manual_mode: false },
        })
      }
      if (table === 'chat_messages') {
        return makeChain({ data: { id: 'user-msg-id', session_id: SESSION_ID } })
      }
      return makeChain({ data: null })
    }),
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdmin,
}))

const { POST } = await import('../../routes/api/chat/message/+server')

function makeEvent() {
  return {
    request: { json: async () => ({ session_id: SESSION_ID, content: '상품이 파손됐어요' }) },
    locals: {
      safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: USER_ID } } }),
      supabase: mockDb,
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('/api/chat/message — 파손신고접수 카드 발송', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('파손 카테고리 매칭 + 활성 예약(confirmed 이상) 존재 → damage_claimed 카드 발송', async () => {
    setup({ cannedMatch: { id: 'canned-1', content: '파손 신고 접수했습니다', category: 'damage' }, activeReservationId: 777 })
    await POST(makeEvent())

    const damageCall = rpcCalls.find(
      (c) => c.name === 'send_rental_chat_notification' && (c.args as { p_notify_type?: string })?.p_notify_type === 'damage_claimed',
    )
    expect(damageCall).toBeDefined()
    expect((damageCall?.args as { p_reservation_id?: number })?.p_reservation_id).toBe(777)
  })

  it('파손 카테고리 매칭 + 활성 예약 없음(hold뿐이거나 전혀 없음) → 카드 발송 스킵(fail-soft, 에러 없이 정상 응답)', async () => {
    setup({ cannedMatch: { id: 'canned-1', content: '파손 신고 접수했습니다', category: 'damage' }, activeReservationId: null })
    const result = (await POST(makeEvent())) as unknown as { status: number }

    const damageCall = rpcCalls.find((c) => c.name === 'send_rental_chat_notification')
    expect(damageCall).toBeUndefined()
    expect(result.status).toBe(201)
  })

  it('매칭된 캔드응답이 damage 카테고리가 아니면(예: 일반 카테고리) 카드 발송 안 함', async () => {
    setup({ cannedMatch: { id: 'canned-2', content: '영업시간 안내입니다', category: 'general' }, activeReservationId: 777 })
    await POST(makeEvent())

    const damageCall = rpcCalls.find((c) => c.name === 'send_rental_chat_notification')
    expect(damageCall).toBeUndefined()
  })
})
