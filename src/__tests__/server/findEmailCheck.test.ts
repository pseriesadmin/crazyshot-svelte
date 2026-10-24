import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 아이디 찾기 사전 확인(문자 발송 없음) — 일치 여부만 알리고, 요청자당 분당 10회로 제한한다 */
vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }))

const state: { rows: unknown[] } = { rows: [] }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const p: unknown = new Proxy({}, {
        get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: state.rows, error: null }).then(res) : () => p),
      })
      return p
    },
  }),
}))

const { POST } = await import('../../routes/api/auth/find-email/check/+server')
type H = (e: never) => Promise<{ status: number; data: { ok: boolean; matched?: boolean } }>
let n = 0
const post = (body: unknown, ip = `ip-${n}`) =>
  (POST as unknown as H)({ request: new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }), getClientAddress: () => ip } as never)
const row = (o = {}) => ({ user_id: 'u', full_name: '홍길동', cms_role: null, withdrawal_status: 'none', email: 'a@b.com', ...o })
const body = { name: '홍길동', phone: '010-1234-5678' }

beforeEach(() => { n++; state.rows = [row()] })

describe('POST /api/auth/find-email/check', () => {
  it('일치하면 matched true, 불일치·관리자는 false', async () => {
    expect((await post(body)).data).toEqual({ ok: true, matched: true })
    state.rows = [row({ full_name: '김철수' })]
    expect((await post(body)).data.matched).toBe(false)
    state.rows = [row({ cms_role: 'manager' })]
    expect((await post(body)).data.matched).toBe(false)
  })
  it('형식 오류는 400', async () => {
    expect((await post({ name: '홍', phone: '010-1234-5678' })).status).toBe(400)
  })
  it('같은 요청자는 분당 10회까지, 11번째는 429', async () => {
    for (let i = 0; i < 10; i++) expect((await post(body, 'same')).status).toBe(200)
    expect((await post(body, 'same')).status).toBe(429)
  })
})
