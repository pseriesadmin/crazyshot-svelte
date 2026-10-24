import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 아이디 찾기 인증번호 발송 — 이름+휴대폰 일치 확인 (2026-10-24)
 * 완료기준: 일치할 때만 인증번호 저장·발송(개발환경은 devCode) / 미가입·이름 불일치·관리자·탈회 완전삭제·중복 계정은 같은 문구 404(저장·발송 없음) /
 *          공백·대소문자 차이 허용 / 1분 쿨다운·1시간 5회 한도 / 세션 없으면 401 / 형식 오류 400
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'service-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }))
vi.mock('$app/environment', () => ({ dev: true }))
vi.mock('$lib/server/sms', () => ({ sendSms: vi.fn(async () => undefined) }))

type Result = { data: unknown; error: unknown }
const state: { recent: Result; profiles: Result; inserted: number } = { recent: { data: [], error: null }, profiles: { data: [], error: null }, inserted: 0 }

function chain(getResult: () => Result, onInsert?: () => void): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: Result) => unknown) => Promise.resolve(getResult()).then(res)
      if (prop === 'insert') return () => { onInsert?.(); return Promise.resolve({ error: null }) }
      return () => proxy
    },
  })
  return proxy
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => (table === 'phone_otps' ? chain(() => state.recent, () => { state.inserted++ }) : chain(() => state.profiles)),
  }),
}))

const { POST } = await import('../../routes/api/auth/find-email/send-otp/+server')
type Handler = (event: never) => Promise<{ status: number; data: { ok: boolean; error?: string; devCode?: string } }>
const post = (body: unknown, session: { user: { id: string } } | null = { user: { id: 'anon-uid' } }) =>
  (POST as unknown as Handler)({
    request: new Request('https://x.test/api', { method: 'POST', body: JSON.stringify(body) }),
    locals: { safeGetSession: async () => ({ session }) },
  } as never)

const row = (o: Record<string, unknown> = {}) => ({ user_id: 'u1', full_name: '홍길동', cms_role: null, withdrawal_status: 'none', email: 'a@b.com', ...o })
const body = { name: '홍길동', phone: '010-1234-5678' }

beforeEach(() => {
  state.recent = { data: [], error: null }
  state.profiles = { data: [row()], error: null }
  state.inserted = 0
})

describe('POST /api/auth/find-email/send-otp', () => {
  it('이름·휴대폰이 일치하면 인증번호를 저장하고 devCode를 돌려준다', async () => {
    const r = await post(body)
    expect(r.status).toBe(200)
    expect(r.data.ok).toBe(true)
    expect(r.data.devCode).toMatch(/^\d{6}$/)
    expect(state.inserted).toBe(1)
  })
  it('공백·대소문자 차이는 같은 이름으로 본다', async () => {
    state.profiles = { data: [row({ full_name: 'Hong Gildong' })], error: null }
    expect((await post({ ...body, name: ' hong  gildong ' })).data.ok).toBe(true)
  })
  it.each([
    ['번호 미가입', { data: [], error: null }],
    ['이름 불일치', { data: [row({ full_name: '김철수' })], error: null }],
    ['관리자 계정', { data: [row({ cms_role: 'manager' })], error: null }],
    ['탈회 완전삭제', { data: [row({ withdrawal_status: 'purged' })], error: null }],
    ['익명화 이메일', { data: [row({ email: 'deleted-x@purged.crazyshot.kr' })], error: null }],
    ['동일 번호 다중 계정', { data: [row(), row({ user_id: 'u2' })], error: null }],
  ])('%s → 같은 문구 404, 저장 없음', async (_n, profiles) => {
    state.profiles = profiles
    const r = await post(body)
    expect(r.status).toBe(404)
    expect(r.data.error).toBe('입력하신 이름과 휴대폰 정보가 일치하는 계정을 찾을 수 없어요.')
    expect(state.inserted).toBe(0)
  })
  it('1분 안 재요청은 429', async () => {
    state.recent = { data: [{ created_at: new Date().toISOString() }], error: null }
    expect((await post(body)).status).toBe(429)
    expect(state.inserted).toBe(0)
  })
  it('1시간 5회를 넘으면 429', async () => {
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    state.recent = { data: Array.from({ length: 5 }, () => ({ created_at: old })), error: null }
    expect((await post(body)).status).toBe(429)
  })
  it('세션이 없으면 401, 형식이 틀리면 400', async () => {
    expect((await post(body, null)).status).toBe(401)
    expect((await post({ name: '홍', phone: '010-1234-5678' })).status).toBe(400)
    expect((await post({ name: '홍길동', phone: '123' })).status).toBe(400)
  })
})
