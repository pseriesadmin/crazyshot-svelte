import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CMS 로그인 액션 배선 — 제한 초과 시 인증 서버를 호출하지 않고 429, 실패 기록, 성공 시 기록 삭제, 새 환경 로그인 시 감사로그·푸시 (sp3 m5)
 */
vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, location: string) => { throw { status, location } },
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }))
vi.mock('$lib/server/sms', () => ({ sendSms: vi.fn() }))
vi.mock('$lib/server/otpCode', () => ({ generateOtpCode: () => '123456' }))
vi.mock('$lib/server/recoveryOtp', () => ({ hashRecoveryOtp: () => 'h', recoveryOtpMatches: () => false }))

const m = vi.hoisted(() => ({
  isLoginBlocked: vi.fn(async () => false),
  recordLoginFailure: vi.fn(async () => undefined),
  clearLoginFailures: vi.fn(async () => undefined),
  isNewLoginEnvironment: vi.fn(() => false),
  audit: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  profile: vi.fn(async () => ({ cms_role: 'manager' }) as { cms_role: string | null } | null),
}))
vi.mock('$lib/server/cmsLoginGuard', () => ({
  LOGIN_BLOCKED_MESSAGE: '로그인 시도가 너무 많아요. 15분 후 다시 시도해주세요.',
  UNKNOWN_IP: 'unknown',
  hashLoginEmail: () => 'hash',
  isLoginBlocked: m.isLoginBlocked,
  recordLoginFailure: m.recordLoginFailure,
  clearLoginFailures: m.clearLoginFailures,
  isNewLoginEnvironment: m.isNewLoginEnvironment,
}))
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: m.audit }))
vi.mock('$lib/server/push', () => ({ sendSecurityPushToUser: m.push }))
vi.mock('$lib/server/cmsProfile', () => ({ fetchCmsProfileByAuthId: m.profile }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const p: unknown = new Proxy({}, {
        get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) : () => p),
      })
      return p
    },
  }),
}))

const { actions } = await import('../../routes/cms/login/+page.server')

const signIn = vi.fn()
function run(email = 'admin@example.com', password = 'pw') {
  const form = new FormData()
  form.set('email', email)
  form.set('password', password)
  return (actions.login as unknown as (e: never) => Promise<{ status: number; data: { error?: string } }>)({
    request: new Request('https://x.test', { method: 'POST', body: form, headers: { 'x-forwarded-for': '1.1.1.1', 'user-agent': 'UA' } }),
    locals: { supabase: { auth: { signInWithPassword: signIn, signOut: vi.fn() } } },
    cookies: { set: vi.fn() },
    getClientAddress: () => '1.1.1.1',
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.isLoginBlocked.mockResolvedValue(false)
  m.isNewLoginEnvironment.mockReturnValue(false)
  m.profile.mockResolvedValue({ cms_role: 'manager' })
  signIn.mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'admin@example.com' } } }, error: null })
})

describe('CMS 로그인 액션 — 제한 배선', () => {
  it('제한에 걸리면 429 로 거절하고 인증 서버를 호출하지 않는다', async () => {
    m.isLoginBlocked.mockResolvedValue(true)
    const r = await run()
    expect(r.status).toBe(429)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('비밀번호가 틀리면 401 + 실패 기록, 성공 기록 삭제는 하지 않는다', async () => {
    signIn.mockResolvedValue({ data: { session: null }, error: { message: 'bad' } })
    const r = await run()
    expect(r.status).toBe(401)
    expect(m.recordLoginFailure).toHaveBeenCalledTimes(1)
    expect(m.clearLoginFailures).not.toHaveBeenCalled()
  })

  it('성공하면 이메일 실패 기록을 삭제하고 /cms 로 이동한다', async () => {
    await expect(run()).rejects.toMatchObject({ status: 303, location: '/cms' })
    expect(m.clearLoginFailures).toHaveBeenCalledTimes(1)
    expect(m.recordLoginFailure).not.toHaveBeenCalled()
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('새 환경에서 성공하면 감사로그와 보안 푸시를 보낸다', async () => {
    m.isNewLoginEnvironment.mockReturnValue(true)
    await expect(run()).rejects.toMatchObject({ status: 303 })
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionType: 'login_new_environment', actorId: 'u1' }))
    expect(m.push).toHaveBeenCalledWith('u1', 'admin_login_new_environment', expect.objectContaining({ title: expect.any(String) }))
  })
})
