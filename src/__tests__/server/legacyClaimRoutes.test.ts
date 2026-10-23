import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 기존 회원 인증 라우트 방어 시험 — complete(롤백·충돌 안내)·set-password(30분 창·세션) (2026-10-23, sp3 MAJOR-1)
 * DB·인증 서버 없이 핸들러를 mock 클라이언트로 직접 호출한다.
 */
const h = vi.hoisted(() => ({
  admin: null as unknown,
  signInArgs: [] as unknown[],
  signIn: null as unknown as () => Promise<{ data: { session: unknown } | null; error: { message: string } | null }>,
}))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost', getSupabaseAnonKey: () => 'anon-key' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { signInWithPassword: (a: unknown) => { h.signInArgs.push(a); return h.signIn() } } }) }))

import { POST as completePost } from '../../routes/api/auth/legacy-claim/complete/+server'
import { POST as setPasswordPost } from '../../routes/api/auth/legacy-claim/set-password/+server'

type Row = { data: unknown; error: unknown }
interface FakeCfg {
  /** from(table).<op> 결과 — op: select/update/delete */
  from?: (table: string, op: string) => Row | undefined
  createUser?: () => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }>
  member?: Record<string, unknown> | null
  appMeta?: Record<string, unknown>
  getUserFails?: boolean
  noEmail?: boolean
}

function makeAdmin(cfg: FakeCfg) {
  const calls: string[] = []
  const admin = {
    calls,
    rpc: async () => ({ data: cfg.member === undefined ? null : cfg.member, error: null }),
    from(table: string) {
      const st = { op: 'select' }
      const resolve = (): Row => {
        calls.push(`${table}.${st.op}`)
        return cfg.from?.(table, st.op) ?? { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => { st.op = 'update'; return chain },
        delete: () => { st.op = 'delete'; return chain },
        eq: () => chain, not: () => chain, is: () => chain,
        single: async () => resolve(),
        maybeSingle: async () => resolve(),
        then: (ok: (v: Row) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ng),
      }
      return chain
    },
    auth: {
      admin: {
        createUser: async () => { calls.push('auth.createUser'); return cfg.createUser ? cfg.createUser() : { data: { user: { id: 'u-1' } }, error: null } },
        deleteUser: async () => { calls.push('auth.deleteUser'); return { error: null } },
        updateUserById: async (id: string, attrs: { password?: string }) => { calls.push(`auth.updateUserById:${id}:${attrs.password}`); return { error: null } },
        getUserById: async () => (cfg.getUserFails ? { data: { user: null }, error: { message: 'down' } } : { data: { user: { email: cfg.noEmail ? undefined : 'a@example.com', app_metadata: cfg.appMeta ?? {} } }, error: null }),
        
      },
    },
  }
  return admin
}

const member = { staging_id: 'st-1', email: 'a@example.com', name: '홍길동', phone: '01012345678', legacy_source: 'csv', legacy_signup_at: null, legacy_purchase_count: 0, legacy_imported_at: null }
const cookies = { getAll: () => [], set: () => undefined }

const callComplete = () =>
  completePost({
    request: new Request('http://x/api', { method: 'POST', body: JSON.stringify({ token: 'tok', name: '홍길동', phone: '01012345678' }) }),
    cookies,
  } as never)

const otpRow = { data: { id: 'tok', phone: '01012345678', verified_at: new Date(Date.now() - 60_000).toISOString() }, error: null }

describe('[TDD] complete — 부분 실패 처리', () => {
  beforeEach(() => {
    h.signIn = async () => ({ data: { session: {} }, error: null })
  })

  it('로그인 단계가 실패하면 방금 만든 계정을 지우고, 대기 목록 행·인증 기록은 건드리지 않는다(재시도 가능)', async () => {
    const admin = makeAdmin({
      member,
      from: (t, op) => (t === 'legacy_claim_otps' && op === 'select' ? otpRow : undefined),
    })
    h.admin = admin
    h.signIn = async () => ({ data: null, error: { message: 'Invalid API key' } })

    const res = await callComplete()
    expect(res.status).toBe(500)
    expect(admin.calls).toContain('auth.deleteUser')
    expect(admin.calls).not.toContain('legacy_member_staging.delete')
    expect(admin.calls).not.toContain('legacy_claim_otps.update')
  })

  it('전화번호가 이미 다른 계정에 있어 프로필 갱신이 유일 제약(23505)으로 실패하면 계정을 되돌리고 409로 안내한다', async () => {
    const admin = makeAdmin({
      member,
      from: (t, op) => {
        if (t === 'legacy_claim_otps' && op === 'select') return otpRow
        if (t === 'user_profiles' && op === 'update') return { data: null, error: { code: '23505', message: 'duplicate' } }
        return undefined
      },
    })
    h.admin = admin

    const res = await callComplete()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('phone_registered')
    expect(admin.calls).toContain('auth.deleteUser')
    expect(admin.calls).not.toContain('legacy_member_staging.delete')
  })

  it('같은 이메일로 이미 일반 가입한 계정이 있으면(인증 계정 아님) 서버 오류 대신 409로 안내하고 대기 행을 보존한다', async () => {
    const admin = makeAdmin({
      member,
      createUser: async () => ({ data: null, error: { message: 'A user with this email address has already been registered' } }),
      from: (t, op) => {
        if (t === 'legacy_claim_otps' && op === 'select') return otpRow
        if (t === 'user_profiles' && op === 'select') return { data: { legacy_claimed_at: null }, error: null }
        return undefined
      },
    })
    h.admin = admin

    const res = await callComplete()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('email_registered')
    expect(admin.calls).not.toContain('legacy_member_staging.delete')
  })

  it('성공하면 로그인까지 끝난 뒤에 대기 행을 지우고 인증 기록을 닫으며 비밀번호 설정을 요청한다', async () => {
    const admin = makeAdmin({
      member,
      from: (t, op) => (t === 'legacy_claim_otps' && op === 'select' ? otpRow : undefined),
    })
    h.admin = admin

    const res = await callComplete()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.needsPassword).toBe(true)
    expect(admin.calls).toContain('legacy_member_staging.delete')
    expect(admin.calls).toContain('legacy_claim_otps.update')
    expect(admin.calls).not.toContain('auth.deleteUser')
  })

  it('인증번호 확인 후 15분이 지난 토큰은 계정을 만들지 않고 400(token_expired)', async () => {
    const old = { data: { id: 'tok', phone: '01012345678', verified_at: new Date(Date.now() - 16 * 60_000).toISOString() }, error: null }
    const admin = makeAdmin({ member, from: (t, op) => (t === 'legacy_claim_otps' && op === 'select' ? old : undefined) })
    h.admin = admin
    const res = await callComplete()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('token_expired')
    expect(admin.calls).not.toContain('auth.createUser')
  })

  it('인증 토큰이 유효하지 않으면(검증 완료 기록 없음) 계정을 만들지 않는다', async () => {
    const admin = makeAdmin({ member, from: (t, op) => (t === 'legacy_claim_otps' && op === 'select' ? { data: null, error: null } : undefined) })
    h.admin = admin
    const res = await callComplete()
    expect(res.status).toBe(400)
    expect(admin.calls).not.toContain('auth.createUser')
  })
})

describe('[TDD] set-password — 세션·30분 창·비밀번호 규칙', () => {
  beforeEach(() => { h.signInArgs = []; h.signIn = async () => ({ data: { session: {} }, error: null }) })
  const call = (password: unknown, session: unknown) =>
    setPasswordPost({
      request: new Request('http://x/api', { method: 'POST', body: JSON.stringify({ password }) }),
      locals: { safeGetSession: async () => ({ session }) },
      cookies,
    } as never)
  const session = { user: { id: 'user-1' }, access_token: 'jwt-1' }
  const claimedAgo = (min: number) => ({ data: { legacy_claimed_at: new Date(Date.now() - min * 60_000).toISOString() }, error: null })

  it('로그인 세션이 없으면 401', async () => {
    h.admin = makeAdmin({})
    expect((await call('abc123!', null)).status).toBe(401)
  })

  it('기존 회원 인증으로 만든 계정이 아니면(일반 가입 등) 403 — 현재 비밀번호 없이 바꾸는 용도로 쓸 수 없다', async () => {
    const admin = makeAdmin({ from: () => ({ data: { legacy_claimed_at: null }, error: null }) })
    h.admin = admin
    expect((await call('abc123!', session)).status).toBe(403)
    expect(admin.calls.some((c) => c.startsWith('auth.updateUserById'))).toBe(false)
  })

  it('인증 후 30분이 지나면 403', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(31) })
    h.admin = admin
    expect((await call('abc123!', session)).status).toBe(403)
    expect(admin.calls.some((c) => c.startsWith('auth.updateUserById'))).toBe(false)
  })

  it('30분 안이면 세션 사용자 본인 계정의 비밀번호만 바꾼다', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(5) })
    h.admin = admin
    const res = await call('abc123!', session)
    expect(res.status).toBe(200)
    expect(admin.calls).toContain('auth.updateUserById:user-1:abc123!')
    // 비밀번호를 바꾸면 모든 세션이 끝나므로 같은 계정·새 비밀번호로 다시 로그인해 이 브라우저 세션을 되살린다
    expect(h.signInArgs).toEqual([{ email: 'a@example.com', password: 'abc123!' }])
    expect((await res.json()).relogin).toBe(true)
  })

  it('이미 한 번 설정한 계정은 30분 안이어도 403 — 다시 바꿀 수 없고 다른 기기도 건드리지 않는다', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(5), appMeta: { legacy_password_set_at: '2026-10-23T00:00:00Z' } })
    h.admin = admin
    expect((await call('abc123!', session)).status).toBe(403)
    expect(admin.calls.some((c) => c.startsWith('auth.updateUserById'))).toBe(false)
  })

  it('계정 조회가 실패하면 500으로 막고 비밀번호를 바꾸지 않는다(fail-closed)', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(5), getUserFails: true })
    h.admin = admin
    expect((await call('abc123!', session)).status).toBe(500)
    expect(admin.calls.some((c) => c.startsWith('auth.updateUserById'))).toBe(false)
  })

  it('다시 로그인에 실패해도 비밀번호 설정은 성공으로 응답하되 relogin=false로 알린다', async () => {
    h.signIn = async () => ({ data: null, error: { message: 'x' } })
    const admin = makeAdmin({ from: () => claimedAgo(5) })
    h.admin = admin
    const res = await call('abc123!', session)
    expect(res.status).toBe(200)
    expect((await res.json()).relogin).toBe(false)
  })

  it('계정에 이메일이 없어 다시 로그인할 수 없으면 relogin=false로 알린다', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(5), noEmail: true })
    h.admin = admin
    const res = await call('abc123!', session)
    expect(res.status).toBe(200)
    expect((await res.json()).relogin).toBe(false)
    expect(h.signInArgs).toEqual([])
  })

  it('너무 짧거나 한글이 섞인 비밀번호는 400', async () => {
    const admin = makeAdmin({ from: () => claimedAgo(1) })
    h.admin = admin
    expect((await call('12345', session)).status).toBe(400)
    expect((await call('비밀번호123!', session)).status).toBe(400)
    expect(admin.calls.some((c) => c.startsWith('auth.updateUserById'))).toBe(false)
  })
})
