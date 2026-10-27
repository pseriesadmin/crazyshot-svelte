// mergeGuestChatApi.test.ts — /api/auth/merge-guest-chat: 회원 세션 + 유효한 익명 토큰이 둘 다 있을 때만 DB 통합 함수를 호출
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const mockGetUser = vi.fn()
const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mockGetUser }, rpc: mockRpc }) }))

const { POST } = await import('../../routes/api/auth/merge-guest-chat/+server')

function call(opts: { session: unknown; body?: unknown }) {
  return POST({
    locals: { safeGetSession: vi.fn().mockResolvedValue({ session: opts.session }) },
    request: { json: async () => opts.body ?? { guest_access_token: 'guest-tok' } },
  } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<{ status: number; data: Record<string, unknown> }>
}
const MEMBER = { user: { id: 'member-1', is_anonymous: false } }

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/auth/merge-guest-chat', () => {
  it('로그인하지 않았으면 401', async () => {
    expect((await call({ session: null })).status).toBe(401)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('익명 세션으로는 호출할 수 없다(400)', async () => {
    expect((await call({ session: { user: { id: 'x', is_anonymous: true } } })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('비회원 토큰이 없거나 너무 길면 400', async () => {
    expect((await call({ session: MEMBER, body: {} })).status).toBe(400)
    expect((await call({ session: MEMBER, body: { guest_access_token: 'a'.repeat(5000) } })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('토큰이 유효하지 않으면 400, 통합하지 않는다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    expect((await call({ session: MEMBER })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('토큰의 계정이 익명이 아니면(다른 회원 토큰) 통합하지 않는다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'other-member', is_anonymous: false } }, error: null })
    expect((await call({ session: MEMBER })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('유효한 익명 토큰이면 그 ID와 로그인 회원 ID로만 DB 함수를 호출한다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } }, error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, sessions: 1, messages: 5 }, error: null })
    const res = await call({ session: MEMBER })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true, sessions: 1, messages: 5 })
    expect(mockRpc).toHaveBeenCalledWith('merge_guest_chat_into_member', { p_guest_id: 'guest-1', p_member_id: 'member-1' })
  })
  it('DB 함수 오류는 500(상세 미노출)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } }, error: null })
    mockRpc.mockResolvedValue({ data: null, error: { message: 'secret detail' } })
    const res = await call({ session: MEMBER })
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.data)).not.toContain('secret detail')
    spy.mockRestore()
  })
})
