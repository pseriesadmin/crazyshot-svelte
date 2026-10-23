import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 비밀번호 재설정(문자 인증번호) — send-otp / verify-otp / complete (2026-10-23)
 * 완료기준: 이메일+휴대폰이 같은 일반 고객일 때만 발송 / 관리자·삭제 계정 제외 / 번호별 발송 제한 /
 *          인증번호는 해시 저장·5회 시도·3분 유효 / 토큰은 인증 후 10분·1회용 / 비밀번호 규칙 통과 시에만 변경
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$app/environment', () => ({ dev: false }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))

const sendSms = vi.fn(async (..._a: unknown[]) => {})
vi.mock('$lib/server/sms', () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }))
vi.mock('$lib/server/otpCode', () => ({ generateOtpCode: () => '123456' }))

type Row = Record<string, unknown>
const db: { profiles: Row[]; otps: Row[] } = { profiles: [], otps: [] }
const updateUserById = vi.fn()

/** 아주 작은 인메모리 쿼리 빌더 — 이 테스트가 쓰는 호출만 지원 */
function builder(table: 'profiles' | 'otps') {
  const rows = () => db[table]
  type Filter = (r: Row) => boolean
  const filters: Filter[] = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let patch: Row = {}
  let orderBy: { col: string; asc: boolean } | null = null
  let lim: number | null = null
  const apply = () => {
    let out = rows().filter((r) => filters.every((f) => f(r)))
    if (orderBy) out = [...out].sort((a, b) => (String(a[orderBy!.col]) < String(b[orderBy!.col]) ? -1 : 1) * (orderBy!.asc ? 1 : -1))
    if (lim !== null) out = out.slice(0, lim)
    return out
  }
  const run = () => {
    if (op === 'update') {
      const hit = apply()
      hit.forEach((r) => Object.assign(r, patch))
      return { data: hit.map((r) => ({ id: r.id })), error: null }
    }
    return { data: apply(), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
    in: (c: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[c])); return q },
    ilike: (c: string, v: string) => { filters.push((r) => String(r[c] ?? '').toLowerCase() === v.replace(/\\/g, '').toLowerCase()); return q },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q },
    gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return q },
    order: (c: string, o: { ascending: boolean }) => { orderBy = { col: c, asc: o.ascending }; return q },
    limit: (n: number) => { lim = n; return q },
    update: (p: Row) => { op = 'update'; patch = p; return q },
    insert: async (r: Row) => { db[table].push({ attempt_count: 0, verified_at: null, used_at: null, created_at: new Date().toISOString(), ...r }); return { error: null } },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve(run()),
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => builder(t === 'user_profiles' ? 'profiles' : 'otps'),
    auth: { admin: { updateUserById: (...a: unknown[]) => updateUserById(...a) } },
  }),
}))

const send = (await import('../../routes/api/auth/password-reset/send-otp/+server')).POST
const verify = (await import('../../routes/api/auth/password-reset/verify-otp/+server')).POST
const complete = (await import('../../routes/api/auth/password-reset/complete/+server')).POST
const { hashOtpCode } = await import('$lib/server/passwordResetOtp')

type R = { status: number; data: { ok: boolean; error?: string; token?: string; code?: string } }
// 세 핸들러의 이벤트 타입이 라우트마다 달라 호출 시그니처만 단순화한다(테스트에서 쓰는 request만 전달)
type Handler = (event: never) => unknown
const post = (fn: unknown, body: unknown) =>
  (fn as Handler)({ request: new Request('https://x.test/api', { method: 'POST', body: JSON.stringify(body) }) } as never) as Promise<R>

const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const EMAIL = 'dinochan1013@gmail.com'
const PHONE = '01039146146'

beforeEach(() => {
  vi.clearAllMocks()
  db.profiles = [{ user_id: UID, email: EMAIL, phone: PHONE, cms_role: null, withdrawal_status: 'none', deleted_at: null }]
  db.otps = []
  updateUserById.mockResolvedValue({ error: null })
})

describe('send-otp', () => {
  it('이메일·휴대폰이 같은 계정이면 문자를 보내고 인증번호는 해시로만 저장한다', async () => {
    const r = await post(send, { email: ' DinoChan1013@gmail.com ', phone: '010-3914-6146' })
    expect(r.status).toBe(200)
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendSms.mock.calls[0][0]).toBe(PHONE)
    expect(String(sendSms.mock.calls[0][1])).toContain('123456')
    expect(db.otps).toHaveLength(1)
    const row = db.otps[0]
    expect(row.code_hash).toBe(hashOtpCode(String(row.id), '123456'))
    expect(JSON.stringify(row)).not.toContain('"123456"')
  })

  it('프로필에 "010-1234-5678" 하이픈 형식으로 저장된 번호도 같은 번호로 찾는다(운영 고객 약 1/3이 이 형식)', async () => {
    db.profiles[0].phone = '010-3914-6146'
    const r = await post(send, { email: EMAIL, phone: PHONE })
    expect(r.status).toBe(200)
    expect(sendSms.mock.calls[0][0]).toBe(PHONE)
  })

  it('같은 이메일·번호의 계정이 둘 이상이면 진행하지 않는다(모호)', async () => {
    db.profiles.push({ user_id: 'other-uid', email: EMAIL, phone: '010-3914-6146', cms_role: null, withdrawal_status: 'none', deleted_at: null })
    expect((await post(send, { email: EMAIL, phone: PHONE })).status).toBe(404)
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('입력 형식이 틀리면 400 — 문자를 보내지 않는다', async () => {
    expect((await post(send, { email: 'nope', phone: PHONE })).status).toBe(400)
    expect((await post(send, { email: EMAIL, phone: '0212345678' })).status).toBe(400)
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('일치하는 계정이 없으면 404 — 문자를 보내지 않는다(번호만·이메일만 맞아도 불가)', async () => {
    expect((await post(send, { email: 'other@example.com', phone: PHONE })).status).toBe(404)
    expect((await post(send, { email: EMAIL, phone: '01099999999' })).status).toBe(404)
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('삭제 계정·탈회 완전삭제 계정은 발송하지 않는다', async () => {
    for (const patch of [{ deleted_at: '2026-10-01T00:00:00Z' }, { withdrawal_status: 'purged' }]) {
      db.profiles = [{ user_id: UID, email: EMAIL, phone: PHONE, cms_role: null, withdrawal_status: 'none', deleted_at: null, ...patch }]
      expect((await post(send, { email: EMAIL, phone: PHONE })).status).toBe(404)
    }
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('관리자 계정은 발송하지 않고 CMS 안내(403, admin_account)를 돌려준다 — 이메일·번호가 둘 다 일치할 때만', async () => {
    db.profiles = [{ user_id: UID, email: EMAIL, phone: PHONE, cms_role: 'manager', withdrawal_status: 'none', deleted_at: null }]
    const res = await post(send, { email: EMAIL, phone: PHONE })
    expect(res.status).toBe(403)
    expect(res.data).toMatchObject({ ok: false, code: 'admin_account', error: '관리자계정은 CMS를 통해 수정하세요.' })
    // 번호가 다르면 관리자 여부를 알려주지 않는다(일반 '계정 없음')
    const other = await post(send, { email: EMAIL, phone: '01099998888' })
    expect(other.status).toBe(404)
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('60초 안에 다시 요청하면 429, 1시간 5회를 넘으면 429', async () => {
    expect((await post(send, { email: EMAIL, phone: PHONE })).status).toBe(200)
    expect((await post(send, { email: EMAIL, phone: PHONE })).status).toBe(429)
    expect(sendSms).toHaveBeenCalledTimes(1)

    db.otps = Array.from({ length: 5 }, (_, i) => ({ id: `id${i}`, user_id: UID, phone: PHONE, created_at: new Date(Date.now() - (10 + i) * 60 * 1000).toISOString() }))
    const r = await post(send, { email: EMAIL, phone: PHONE })
    expect(r.status).toBe(429)
    expect(sendSms).toHaveBeenCalledTimes(1)
  })

  it('다시 발송하면 이전 인증번호는 무효가 된다', async () => {
    await post(send, { email: EMAIL, phone: PHONE })
    db.otps[0].created_at = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await post(send, { email: EMAIL, phone: PHONE })
    expect(db.otps).toHaveLength(2)
    expect(new Date(String(db.otps[0].expires_at)).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('문자 발송이 실패하면 500', async () => {
    sendSms.mockRejectedValueOnce(new Error('sms down'))
    expect((await post(send, { email: EMAIL, phone: PHONE })).status).toBe(500)
  })
})

describe('verify-otp', () => {
  async function issue() {
    await post(send, { email: EMAIL, phone: PHONE })
    return db.otps[0]
  }

  it('맞는 인증번호면 토큰을 돌려주고 verified_at을 남긴다', async () => {
    const row = await issue()
    const r = await post(verify, { email: EMAIL, phone: PHONE, code: '123456' })
    expect(r.status).toBe(200)
    expect(r.data.token).toBe(row.id)
    expect(row.verified_at).toBeTruthy()
  })

  it('틀린 인증번호는 400이고 시도 횟수가 오른다. 5회 틀리면 맞는 번호도 거절(429)', async () => {
    const row = await issue()
    for (let i = 0; i < 5; i++) expect((await post(verify, { email: EMAIL, phone: PHONE, code: '000000' })).status).toBe(400)
    expect(row.attempt_count).toBe(5)
    const r = await post(verify, { email: EMAIL, phone: PHONE, code: '123456' })
    expect(r.status).toBe(429)
    expect(row.verified_at).toBeNull()
  })

  it('만료된 인증번호·형식이 틀린 입력·다른 계정 정보는 400', async () => {
    const row = await issue()
    expect((await post(verify, { email: EMAIL, phone: PHONE, code: '12345' })).status).toBe(400)
    expect((await post(verify, { email: 'other@example.com', phone: PHONE, code: '123456' })).status).toBe(400)
    row.expires_at = new Date(Date.now() - 1000).toISOString()
    expect((await post(verify, { email: EMAIL, phone: PHONE, code: '123456' })).status).toBe(400)
  })
})

describe('complete', () => {
  async function verifiedToken() {
    await post(send, { email: EMAIL, phone: PHONE })
    const r = await post(verify, { email: EMAIL, phone: PHONE, code: '123456' })
    return r.data.token as string
  }

  it('인증 후 규칙에 맞는 비밀번호면 변경하고 토큰은 1회용이다', async () => {
    const token = await verifiedToken()
    const r = await post(complete, { token, password: 'newpass123!' })
    expect(r.status).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith(UID, { password: 'newpass123!' })
    expect((await post(complete, { token, password: 'another456!' })).status).toBe(400)
    expect(updateUserById).toHaveBeenCalledTimes(1)
  })

  it('인증 전(토큰 없음·미확인)에는 변경할 수 없다', async () => {
    await post(send, { email: EMAIL, phone: PHONE })
    expect((await post(complete, { token: String(db.otps[0].id), password: 'newpass123!' })).status).toBe(400)
    expect((await post(complete, { token: 'not-a-uuid', password: 'newpass123!' })).status).toBe(400)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('인증 후 10분이 지나면 거절한다', async () => {
    const token = await verifiedToken()
    db.otps[0].verified_at = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    expect((await post(complete, { token, password: 'newpass123!' })).status).toBe(400)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('비밀번호 규칙(6~72자, 영문·숫자·특수문자만)을 지키지 않으면 400', async () => {
    const token = await verifiedToken()
    expect((await post(complete, { token, password: '12345' })).status).toBe(400)
    expect((await post(complete, { token, password: '비밀번호abcd' })).status).toBe(400)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('인증 이후 관리자 계정이 된 경우에는 변경하지 않는다', async () => {
    const token = await verifiedToken()
    db.profiles[0].cms_role = 'manager'
    expect((await post(complete, { token, password: 'newpass123!' })).status).toBe(400)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('비밀번호 변경에 실패하면 500이고 토큰을 되돌려 다시 시도할 수 있다', async () => {
    const token = await verifiedToken()
    updateUserById.mockResolvedValueOnce({ error: { message: 'boom' } })
    expect((await post(complete, { token, password: 'newpass123!' })).status).toBe(500)
    expect(db.otps[0].used_at).toBeNull()
    expect((await post(complete, { token, password: 'newpass123!' })).status).toBe(200)
  })
})
