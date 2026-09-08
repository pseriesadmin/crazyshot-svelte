import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/chat/admin-reply — 접근제어 회귀 테스트 (경량)
 * (2026-09-08, execute-action 403 결함 수정과 같은 세션에서 QA 권고로 추가)
 *
 * admin-reply는 이미 "cms_role 보유자면 누구나"(inline user_profiles.cms_role 체크)
 * 방식으로 올바르게 동작하고 있었다 — execute-action처럼 admin_id 1명으로 좁혀 막던
 * 결함은 없었음. 다만 채팅 접근제어 계열 엔드포인트에 회귀 방지 테스트가 전혀 없었기에,
 * 이 올바른 동작을 고정해 향후 실수로 좁혀지는 회귀를 잡기 위해 추가한다.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}))

vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))

vi.mock('$lib/server/synonymLearning', () => ({
  recordSynonymLearning: vi.fn().mockResolvedValue(undefined),
}))

const mockSendPushToUser = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
}))

vi.mock('$lib/server/crossLingualSynonymScan', () => ({
  registerCrossLingualCandidates: vi.fn().mockResolvedValue(undefined),
}))

type TableResult = { data: unknown; error?: unknown }

function makeChain(result: TableResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (resolve: (v: TableResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

let mockAdmin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }

function makeAdminStub(tables: Record<string, TableResult>) {
  return {
    from: vi.fn((table: string) => makeChain(tables[table] ?? { data: null, error: null })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdmin,
}))

const { POST } = await import('../../routes/api/chat/admin-reply/+server')

const CALLER_ID = 'caller-uid'
const SESSION_ID = 'session-1'
const CUSTOMER_ID = 'customer-uid'

function makeEvent(opts: {
  userId?: string | null
  cmsRole?: string | null
  status?: string
}) {
  const { userId = CALLER_ID, cmsRole = null, status = 'open' } = opts

  mockAdmin = makeAdminStub({
    user_profiles: { data: { cms_role: cmsRole } },
    chat_sessions: { data: { id: SESSION_ID, user_id: CUSTOMER_ID, admin_id: CALLER_ID, status } },
    chat_messages: { data: { id: 'new-msg-id', session_id: SESSION_ID, content: '답변입니다' } },
  })

  return {
    request: {
      json: async () => ({ session_id: SESSION_ID, content: '답변입니다' }),
    },
    locals: {
      safeGetSession: vi.fn().mockResolvedValue(
        userId ? { session: { user: { id: userId } } } : { session: null },
      ),
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('/api/chat/admin-reply — 접근제어', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비로그인 → 401', async () => {
    const result = (await POST(makeEvent({ userId: null }))) as unknown as { status: number }
    expect(result.status).toBe(401)
  })

  it('cms_role 없는 일반 로그인 사용자 → 403 (관리자 권한 필요)', async () => {
    const result = (await POST(makeEvent({ userId: CALLER_ID, cmsRole: null }))) as unknown as {
      status: number
    }
    expect(result.status).toBe(403)
  })

  it('cms_role 보유(partner) → 200, 메시지 반환 (무회귀 — 등급 제한 없이 전부 허용)', async () => {
    const result = (await POST(
      makeEvent({ userId: CALLER_ID, cmsRole: 'partner' }),
    )) as unknown as { status: number; data: { message?: { id: string } } }
    expect(result.status).toBe(200)
    expect(result.data.message?.id).toBe('new-msg-id')
  })

  it('cms_role 보유(manager) → 200 (무회귀)', async () => {
    const result = (await POST(
      makeEvent({ userId: CALLER_ID, cmsRole: 'manager' }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })
})
