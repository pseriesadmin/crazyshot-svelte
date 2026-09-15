import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Defect B — rpcRetryWithFailSoftLog 공유 헬퍼 유닛 테스트
 * Harness Flow v3.2 TDD
 *
 * 검증 시나리오:
 *   TC-1: 1회차 성공 → rpcResult 반환, failed=false
 *   TC-2: 2회 실패 후 3회차 성공 → rpcResult 반환, failed=false
 *   TC-3: 3회 모두 실패 + paymentKey 있음 → fail-soft 3종(DB·푸시·채팅카드) 호출, failed=true
 *   TC-4: 3회 모두 실패 + paymentKey 없음 → fail-soft 호출 없음, failed=true
 */

// ── 모킹 ──────────────────────────────────────────────────────────────────────
const pushAdminsSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: pushAdminsSpy,
}))

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
}))
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))

const { rpcRetryWithFailSoftLog } = await import('$lib/server/rpcRetryWithFailSoftLog')

// ── 공용 mock admin builder ──────────────────────────────────────────────────
function makeAdmin(rpcResponses: Array<{ data: unknown; error: unknown }>) {
  let call = 0
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  const maybeSingleSpy = vi.fn().mockResolvedValue({ data: { user_id: 'user-abc' }, error: null })
  const chatRpcSpy = vi.fn().mockResolvedValue({ data: 'session-1', error: null })

  const admin = {
    rpc: vi.fn((name: string) => {
      // 'find_or_create_general_chat_session' 은 fail-soft 내부에서 별도 호출됨
      if (name === 'find_or_create_general_chat_session') return chatRpcSpy()
      return rpcResponses[call++] ?? { data: null, error: { message: 'no more responses' } }
    }),
    from: vi.fn((table: string) => ({
      update: updateSpy,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleSpy }),
      }),
      insert: insertSpy,
    })),
    _updateSpy: updateSpy,
    _insertSpy: insertSpy,
    _chatRpcSpy: chatRpcSpy,
  }
  return admin
}

// ── 공통 옵션 ────────────────────────────────────────────────────────────────
const BASE_OPTS = {
  rpcName: 'test_rpc',
  rpcParams: { p_id: 1 },
  isSuccess: (r: { ok: boolean } | null) => r !== null && r.ok === true,
  reservationId: 42,
  contextLabel: '테스트 컨텍스트',
}

describe('rpcRetryWithFailSoftLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC-1: 1회차 성공 → failed=false, rpcResult 반환', async () => {
    const admin = makeAdmin([{ data: { ok: true }, error: null }])
    const result = await rpcRetryWithFailSoftLog({ ...BASE_OPTS, admin: admin as never, paymentKey: 'pk-1' })

    expect(result.failed).toBe(false)
    expect((result.rpcResult as { ok: boolean } | null)?.ok).toBe(true)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin._updateSpy).not.toHaveBeenCalled()
    expect(pushAdminsSpy).not.toHaveBeenCalled()
  })

  it('TC-2: 2회 실패 후 3회차 성공 → failed=false', async () => {
    const admin = makeAdmin([
      { data: null, error: { message: 'timeout' } },
      { data: null, error: { message: 'timeout' } },
      { data: { ok: true }, error: null },
    ])
    const result = await rpcRetryWithFailSoftLog({ ...BASE_OPTS, admin: admin as never, paymentKey: 'pk-1' })

    expect(result.failed).toBe(false)
    expect(admin.rpc).toHaveBeenCalledTimes(3)
    expect(pushAdminsSpy).not.toHaveBeenCalled()
  })

  it('TC-3: 3회 모두 실패 + paymentKey → fail-soft 3종 호출, failed=true', async () => {
    const admin = makeAdmin([
      { data: null, error: { message: 'DB error' } },
      { data: null, error: { message: 'DB error' } },
      { data: null, error: { message: 'DB error' } },
    ])
    const result = await rpcRetryWithFailSoftLog({ ...BASE_OPTS, admin: admin as never, paymentKey: 'pk-fail' })

    expect(result.failed).toBe(true)
    expect(result.failureReason).toContain('DB error')
    // fail-soft: DB update
    expect(admin._updateSpy).toHaveBeenCalled()
    // fail-soft: 관리자 push
    expect(pushAdminsSpy).toHaveBeenCalledWith('payment_completed', expect.objectContaining({ title: expect.stringContaining('테스트 컨텍스트') }))
    // fail-soft: 채팅카드 — find_or_create_general_chat_session 호출됨
    expect(admin._chatRpcSpy).toHaveBeenCalled()
    // 채팅카드 insert
    expect(admin._insertSpy).toHaveBeenCalled()
  })

  it('TC-4: 3회 모두 실패 + paymentKey 없음 → fail-soft 호출 안 됨, failed=true', async () => {
    const admin = makeAdmin([
      { data: null, error: { message: 'network' } },
      { data: null, error: { message: 'network' } },
      { data: null, error: { message: 'network' } },
    ])
    const result = await rpcRetryWithFailSoftLog({ ...BASE_OPTS, admin: admin as never, paymentKey: null })

    expect(result.failed).toBe(true)
    expect(admin._updateSpy).not.toHaveBeenCalled()
    expect(pushAdminsSpy).not.toHaveBeenCalled()
    expect(admin._insertSpy).not.toHaveBeenCalled()
  })
})
