import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 아이디(이메일) 찾기 — 이름 비교 (2026-10-24)
 * 완료기준: 휴대폰 인증번호가 맞아도 가입 이름이 일치해야만 가려진 이메일을 돌려준다 / 번호 미가입·이름 불일치·동일 번호 다중 계정은 같은 문구로 404 /
 *          공백·대소문자 차이는 같은 이름으로 본다 / 하이픈 형식으로 저장된 번호도 찾는다 / 인증번호가 틀리면 400(이름 비교까지 가지 않음)
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'service-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }))

type Result = { data: unknown; error: unknown }
const state: {
  otp: Result
  profiles: Result
  email: string | null
  inArgs: unknown[]
  otpUpdated: boolean
} = { otp: { data: { id: 'otp-1' }, error: null }, profiles: { data: [], error: null }, email: 'hong.gildong@example.com', inArgs: [], otpUpdated: false }

/** 모든 체이닝 메서드가 자기 자신을 돌려주고, await·maybeSingle 시 지정한 결과로 끝나는 쿼리 빌더 */
function chain(getResult: () => Result, onIn?: (args: unknown[]) => void, onUpdate?: () => void): unknown {
  const target: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: Result) => unknown) => Promise.resolve(getResult()).then(res)
      if (prop === 'maybeSingle') return () => Promise.resolve(getResult())
      if (prop === 'in') return (...a: unknown[]) => { onIn?.(a); return proxy }
      if (prop === 'update') return () => { onUpdate?.(); return proxy }
      return () => proxy
    },
  })
  return proxy
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) =>
      table === 'phone_otps'
        ? chain(() => state.otp, undefined, () => { state.otpUpdated = true })
        : chain(() => state.profiles, (a) => { state.inArgs = a }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: state.email ? { email: state.email } : null }, error: null }),
      },
    },
  }),
}))

const { POST } = await import('../../routes/api/auth/find-email/+server')

type Handler = (event: never) => Promise<{ status: number; data: { ok: boolean; error?: string; email?: string } }>
const post = (body: unknown, session: { user: { id: string } } | null = { user: { id: 'anon-uid' } }) =>
  (POST as unknown as Handler)({
    request: new Request('https://x.test/api', { method: 'POST', body: JSON.stringify(body) }),
    locals: { safeGetSession: async () => ({ session }) },
  } as never)

const PROFILE = { user_id: 'member-uid', full_name: '홍 길동' }
const good = { phone: '010-1234-5678', code: '123456', name: '홍길동' }

beforeEach(() => {
  state.otp = { data: { id: 'otp-1' }, error: null }
  state.profiles = { data: [PROFILE], error: null }
  state.email = 'hong.gildong@example.com'
  state.inArgs = []
  state.otpUpdated = false
})

describe('POST /api/auth/find-email — 이름 비교', () => {
  it('인증번호·이름이 모두 맞으면 가려진 이메일을 돌려준다(공백 차이는 같은 이름)', async () => {
    const r = await post(good)
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ ok: true, email: 'ho**********@example.com' })
    expect(state.otpUpdated).toBe(true)
  })

  it('대소문자가 달라도 같은 이름으로 본다', async () => {
    state.profiles = { data: [{ user_id: 'member-uid', full_name: 'Kim Soyun' }], error: null }
    const r = await post({ ...good, name: 'KIM SOYUN' })
    expect(r.status).toBe(200)
  })

  it('이름이 다르면 404 — 이메일을 돌려주지 않는다', async () => {
    const r = await post({ ...good, name: '김철수' })
    expect(r.status).toBe(404)
    expect(r.data.ok).toBe(false)
    expect(r.data.email).toBeUndefined()
  })

  it('번호 미가입·동일 번호 다중 계정·이름 없는 계정은 이름 불일치와 같은 문구로 404', async () => {
    const mismatch = await post({ ...good, name: '김철수' })
    state.profiles = { data: [], error: null }
    const none = await post(good)
    state.profiles = { data: [PROFILE, { user_id: 'other', full_name: '홍길동' }], error: null }
    const many = await post(good)
    state.profiles = { data: [{ user_id: 'member-uid', full_name: null }], error: null }
    const noName = await post(good)
    for (const r of [none, many, noName]) {
      expect(r.status).toBe(404)
      expect(r.data.error).toBe(mismatch.data.error)
    }
  })

  it('하이픈 형식으로 저장된 번호도 찾는다(두 형식을 함께 조회)', async () => {
    await post({ ...good, phone: '01012345678' })
    expect(state.inArgs[0]).toBe('phone')
    expect(state.inArgs[1]).toEqual(['01012345678', '010-1234-5678'])
  })

  it('인증번호가 틀리면 400 — 이름 비교까지 가지 않고, 미사용 인증번호를 폐기해 반복 대입을 막는다', async () => {
    state.otp = { data: null, error: null }
    const r = await post(good)
    expect(r.status).toBe(400)
    expect(r.data.email).toBeUndefined()
    expect(state.otpUpdated).toBe(true)
  })

  it.each([
    ['관리자 계정', { cms_role: 'manager' }],
    ['탈회 완전삭제', { withdrawal_status: 'purged' }],
    ['익명화 이메일', { email: 'purged-x@purged.crazyshot.kr' }],
  ])('%s는 이름·인증번호가 맞아도 같은 문구로 404', async (_n, extra) => {
    state.profiles = { data: [{ ...PROFILE, ...extra }], error: null }
    const r = await post(good)
    expect(r.status).toBe(404)
    expect(r.data.email).toBeUndefined()
  })

  it('이름이 없거나 너무 짧으면 400, 세션이 없으면 401', async () => {
    expect((await post({ ...good, name: '' })).status).toBe(400)
    expect((await post({ ...good, name: '홍' })).status).toBe(400)
    expect((await post({ phone: good.phone, code: good.code })).status).toBe(400)
    expect((await post(good, null)).status).toBe(401)
  })
})
