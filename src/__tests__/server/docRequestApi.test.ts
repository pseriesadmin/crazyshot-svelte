import { describe, it, expect, vi, beforeEach } from 'vitest'

/** POST /api/profile/doc-request (2026-10-15) — 비로그인 403 / 로그인 시 서버 헬퍼 호출 결과 전달(요청 여부는 서버가 판정) */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const helperCalls: string[] = []
let helperResult: { requested: boolean; reason: string } = { requested: true, reason: 'sent' }
vi.mock('$lib/server/identityDocRequest', () => ({
  requestIdentityDocRegistration: vi.fn(async (_admin: unknown, userId: string) => {
    helperCalls.push(userId)
    return helperResult
  }),
}))

const locals = (loggedIn: boolean) => ({
  safeGetSession: async () => ({ session: loggedIn ? { user: { id: 'user-1' } } : null }),
}) as never

beforeEach(() => {
  helperCalls.length = 0
  helperResult = { requested: true, reason: 'sent' }
})

describe('POST /api/profile/doc-request', () => {
  it('비로그인 → 403, 헬퍼를 호출하지 않는다', async () => {
    const { POST } = await import('../../routes/api/profile/doc-request/+server')
    const res = await POST({ locals: locals(false) } as never)
    expect(res.status).toBe(403)
    expect(helperCalls).toHaveLength(0)
  })

  it('로그인 → 세션 사용자 id로 헬퍼를 호출하고 결과를 그대로 전달한다', async () => {
    const { POST } = await import('../../routes/api/profile/doc-request/+server')
    const res = await POST({ locals: locals(true) } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, requested: true, reason: 'sent' })
    expect(helperCalls).toEqual(['user-1'])
  })

  it('이미 요청했거나 서류 상태가 none이 아니면 requested=false로 전달한다', async () => {
    helperResult = { requested: false, reason: 'recently_requested' }
    const { POST } = await import('../../routes/api/profile/doc-request/+server')
    const json = await (await POST({ locals: locals(true) } as never)).json()
    expect(json).toEqual({ ok: true, requested: false, reason: 'recently_requested' })
  })
})

describe('익명 세션 차단', () => {
  it('익명 로그인(is_anonymous) 세션 → 403, 헬퍼를 호출하지 않는다', async () => {
    const { POST } = await import('../../routes/api/profile/doc-request/+server')
    const anon = { safeGetSession: async () => ({ session: { user: { id: 'anon-1', is_anonymous: true } } }) } as never
    const before = helperCalls.length
    const res = await POST({ locals: anon } as never)
    expect(res.status).toBe(403)
    expect(helperCalls.length).toBe(before)
  })
})
