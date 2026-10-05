import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/profile/doc-inquiry (2026-10-05) — 승인 대기(pending) 고객의 [문의] 원클릭
 *  - 비로그인 403 / 서류 미등록·승인 완료 상태는 메시지를 만들지 않음 / pending이면 문의+자동 안내+관리자 푸시 / 60분 내 재문의는 중복 발송·푸시 없음
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
const pushCalls: Array<{ key: string; payload: Record<string, unknown> }> = []
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: vi.fn(async (key: string, payload: Record<string, unknown>) => { pushCalls.push({ key, payload }) }),
}))

const profileRow: Record<string, unknown> = {}
const inserted: Array<Record<string, unknown>> = []
const recentExisting = { user: false, admin: false }
let rpcSession: string | null = 'sess-1'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: rpcSession, error: null }),
    from: (table: string) => {
      let senderFilter = ''
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, v: string) => { if (col === 'sender_type') senderFilter = v; return chain },
        gte: () => chain,
        limit: async () => ({ data: (senderFilter === 'user' ? recentExisting.user : recentExisting.admin) ? [{ id: 'x' }] : [], error: null }),
        maybeSingle: async () => ({ data: profileRow, error: null }),
        insert: async (v: Record<string, unknown>) => { inserted.push({ table, ...v }); return { error: null } },
        update: () => chain,
        then: (res: (v: unknown) => unknown) => res({ error: null }),
      })
      return chain
    },
  }),
}))

const locals = (loggedIn: boolean) => ({
  safeGetSession: async () => ({ session: loggedIn ? { user: { id: 'user-1' } } : null }),
}) as never

const PENDING = {
  full_name: '홍길동',
  identity_doc_url: ['user-1/a.pdf', 'user-1/b.pdf'], identity_type: ['resident', 'resident_copy'],
  identity_verified_at: '2026-10-05T01:00:00Z', identity_approved_at: null,
}

beforeEach(() => {
  pushCalls.length = 0; inserted.length = 0
  for (const k of Object.keys(profileRow)) delete profileRow[k]
  recentExisting.user = false; recentExisting.admin = false
  rpcSession = 'sess-1'
})

describe('POST /api/profile/doc-inquiry', () => {
  it('비로그인 → 403', async () => {
    const { POST } = await import('../../routes/api/profile/doc-inquiry/+server')
    const res = await POST({ locals: locals(false) } as never)
    expect(res.status).toBe(403)
  })

  it('서류 미등록(none) → 메시지·푸시 없이 ok', async () => {
    Object.assign(profileRow, { full_name: '홍길동', identity_doc_url: null, identity_type: null })
    const { POST } = await import('../../routes/api/profile/doc-inquiry/+server')
    const json = await (await POST({ locals: locals(true) } as never)).json()
    expect(json).toMatchObject({ ok: true, posted: false, status: 'none' })
    expect(inserted).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
  })

  it('승인 대기(pending) → 고객 문의 + 자동 안내 INSERT, 관리자 푸시(identity_review)', async () => {
    Object.assign(profileRow, PENDING)
    const { POST } = await import('../../routes/api/profile/doc-inquiry/+server')
    const json = await (await POST({ locals: locals(true) } as never)).json()
    expect(json).toMatchObject({ ok: true, posted: true, status: 'pending' })
    const msgs = inserted.filter((m) => m.table === 'chat_messages')
    expect(msgs.map((m) => m.sender_type)).toEqual(['user', 'admin'])
    expect(String(msgs[1].content)).toContain('관리자가 확인하는 대로')
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0].key).toBe('identity_review')
    expect(String(pushCalls[0].payload.link)).toBe('/cms/chat?session=sess-1')
  })

  it('60분 내 같은 문의·안내가 이미 있으면 재발송·푸시하지 않는다', async () => {
    Object.assign(profileRow, PENDING)
    recentExisting.user = true; recentExisting.admin = true
    const { POST } = await import('../../routes/api/profile/doc-inquiry/+server')
    const json = await (await POST({ locals: locals(true) } as never)).json()
    expect(json).toMatchObject({ ok: true, posted: false })
    expect(inserted).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
  })

  it('상담 세션을 얻지 못하면 500(메시지 미생성)', async () => {
    Object.assign(profileRow, PENDING)
    rpcSession = null
    const { POST } = await import('../../routes/api/profile/doc-inquiry/+server')
    const res = await POST({ locals: locals(true) } as never)
    expect(res.status).toBe(500)
    expect(inserted).toHaveLength(0)
  })
})
