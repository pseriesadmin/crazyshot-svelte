import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/chat/attachment — 세션 정책·서버 검증 회귀 테스트 (2026-10-02)
 *  - 종료(closed)·대기(pending) 세션에 첨부를 보내면 텍스트 메시지와 같이 진행중(open)으로 복귀(§7·§13 ①)
 *  - 첨부 URL·파일명을 서버가 검증, 잘못된 JSON은 500이 아니라 400
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' } }))

const adminUpdates: Array<{ table: string; values: Record<string, unknown> }> = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        adminUpdates.push({ table, values })
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }),
}))

const { POST } = await import('../../routes/api/chat/attachment/+server')

const SID = 'sess-1'
const UID = 'user-1'
const GOOD_URL = `https://proj.supabase.co/storage/v1/object/public/chat-attachments/${SID}/1.png`

function makeEvent(opts: { status?: string; body?: unknown; badJson?: boolean; ownerId?: string }) {
  const { status = 'open', ownerId = UID } = opts
  const body = opts.body ?? { session_id: SID, file_name: 'a.png', file_url: GOOD_URL, is_image: true }
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'insert', 'update']) c[m] = () => c
    c.single = () => Promise.resolve(result)
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
    return c
  }
  const db = {
    from: (table: string) =>
      table === 'chat_sessions'
        ? chain({ data: { user_id: ownerId, status } })
        : chain({ data: { id: 'm1', session_id: SID }, error: null }),
  }
  return {
    request: { json: async () => { if (opts.badJson) throw new SyntaxError('bad'); return body } },
    locals: { safeGetSession: async () => ({ session: { user: { id: UID } } }), supabase: db },
  } as unknown as Parameters<typeof POST>[0]
}

describe('/api/chat/attachment', () => {
  beforeEach(() => { adminUpdates.length = 0 })

  it('open 세션 정상 첨부 → 201, 상태 전환 없음', async () => {
    const r = (await POST(makeEvent({ status: 'open' }))) as unknown as { status: number }
    expect(r.status).toBe(201)
    expect(adminUpdates.some((u) => u.values.status === 'open')).toBe(false)
  })

  it('종료(closed) 세션 첨부 → 거절하지 않고 open 복귀', async () => {
    const r = (await POST(makeEvent({ status: 'closed' }))) as unknown as { status: number }
    expect(r.status).toBe(201)
    expect(adminUpdates.some((u) => u.table === 'chat_sessions' && u.values.status === 'open')).toBe(true)
  })

  it('대기(pending) 세션 첨부 → open 승격', async () => {
    const r = (await POST(makeEvent({ status: 'pending' }))) as unknown as { status: number }
    expect(r.status).toBe(201)
    expect(adminUpdates.some((u) => u.table === 'chat_sessions' && u.values.status === 'open')).toBe(true)
  })

  it('타인 세션 → 403', async () => {
    const r = (await POST(makeEvent({ ownerId: 'someone-else' }))) as unknown as { status: number }
    expect(r.status).toBe(403)
  })

  it('임의 URL → 400 (저장·상태전환 없음)', async () => {
    const r = (await POST(makeEvent({ status: 'pending', body: { session_id: SID, file_name: 'a.png', file_url: 'https://evil.example.com/x.png', is_image: true } }))) as unknown as { status: number }
    expect(r.status).toBe(400)
    expect(adminUpdates.length).toBe(0)
  })

  it('잘못된 JSON → 500이 아니라 400', async () => {
    const r = (await POST(makeEvent({ badJson: true }))) as unknown as { status: number }
    expect(r.status).toBe(400)
  })
})
