import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/cms/customers/[id]/recovery-link — 고객 비밀번호 설정 링크 발행 (2026-10-23)
 * 완료기준: manager 이상 + 고객목록 메뉴 권한만 발행 / 관리자(CMS) 계정·탈회 신청·탈회 완전삭제·삭제 계정은 거부 /
 *          링크는 메일 발송 없이 생성만 / 감사로그에 남기되 링크·토큰은 기록하지 않음(기록 실패 시 링크 미반환) /
 *          발급자별 빈도 제한·같은 고객 쿨다운 / 발행 시 관리자 푸시 / 응답은 캐시 금지
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
    status: init?.status ?? 200,
    data,
    headers: init?.headers ?? {},
  }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))

const roleRef: { role: string | null } = { role: 'manager' }
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => roleRef.role }))

const menuDenied: { res: unknown } = { res: null }
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => menuDenied.res }))

const auditOk: { value: boolean } = { value: true }
const audit = vi.fn(async (..._a: unknown[]) => auditOk.value)
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLogStrict: (...a: unknown[]) => audit(...a) }))

const pushAdmins = vi.fn(async (..._a: unknown[]) => {})
vi.mock('$lib/server/push', () => ({ sendPushToAdmins: (...a: unknown[]) => pushAdmins(...a) }))

const profileRef: { row: Record<string, unknown> | null; error: { message: string } | null } = { row: null, error: null }
const logRef: { mine: { created_at: string }[]; target: { created_at: string }[]; error: { message: string } | null } = { mine: [], target: [], error: null }
const getUserById = vi.fn()
const generateLink = vi.fn()

/** 감사로그 집계 조회 흐름: select→eq(user_id|target_user_id)→eq(action_type)→gte→(order)→limit — 어떤 필터로 시작했는지로 결과를 고른다 */
const logCalls: { which: 'mine' | 'target'; eq: [string, unknown][]; gte: [string, string][]; limit: number | null }[] = []
function auditLogQuery() {
  let which: 'mine' | 'target' = 'mine'
  const rec: { which: 'mine' | 'target'; eq: [string, unknown][]; gte: [string, string][]; limit: number | null } = { which, eq: [], gte: [], limit: null }
  logCalls.push(rec)
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, val: unknown) => { if (col === 'target_user_id') { which = 'target'; rec.which = 'target' } rec.eq.push([col, val]); return q },
    gte: (col: string, val: string) => { rec.gte.push([col, val]); return q },
    order: () => q,
    limit: (n: number) => { rec.limit = n; return q },
    then: (resolve: (v: unknown) => void) => resolve({ data: logRef.error ? null : logRef[which], error: logRef.error }),
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) =>
      table === 'cms_admin_audit_log'
        ? auditLogQuery()
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRef.row, error: profileRef.error }) }) }) },
    auth: { admin: { getUserById, generateLink } },
  }),
}))

const { POST } = await import('../../routes/api/cms/customers/[id]/recovery-link/+server')

const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
type R = { status: number; data: { ok: boolean; link?: string; error?: string }; headers: Record<string, string> }

function call(opts: { session?: boolean; id?: string } = {}) {
  const id = opts.id ?? UID
  return POST({
    params: { id },
    url: new URL(`https://www.crazyshot.kr/api/cms/customers/${id}/recovery-link`),
    locals: { safeGetSession: async () => ({ session: opts.session === false ? null : { user: { id: 'admin-uid' } } }) },
  } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<R>
}

describe('POST /api/cms/customers/[id]/recovery-link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roleRef.role = 'manager'
    menuDenied.res = null
    profileRef.error = null
    auditOk.value = true
    logRef.mine = []
    logRef.target = []
    logRef.error = null
    logCalls.length = 0
    profileRef.row = { user_id: UID, cms_role: null, withdrawal_status: 'none', deleted_at: null }
    getUserById.mockResolvedValue({ data: { user: { id: UID, email: 'customer@example.com' } }, error: null })
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'HASHED123' } }, error: null })
  })

  it('세션 없음 401 / 역할 없음·partner 403 — 링크를 만들지 않는다', async () => {
    expect((await call({ session: false })).status).toBe(401)
    roleRef.role = null
    expect((await call()).status).toBe(403)
    roleRef.role = 'partner'
    expect((await call()).status).toBe(403)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('고객목록 메뉴 권한이 OFF로 잠긴 관리자는 거부된다(메뉴 오버레이)', async () => {
    menuDenied.res = { status: 403, data: { error: '메뉴 접근 권한이 없습니다' } }
    expect((await call()).status).toBe(403)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('잘못된 사용자 ID는 400', async () => {
    expect((await call({ id: 'not-a-uuid' })).status).toBe(400)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('고객 프로필이 없으면 404, 조회 오류는 500', async () => {
    profileRef.row = null
    expect((await call()).status).toBe(404)
    profileRef.error = { message: 'boom' }
    expect((await call()).status).toBe(500)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('관리자(CMS) 계정은 이 경로로 링크를 만들 수 없다 — 계정 탈취 방지', async () => {
    for (const role of ['partner', 'manager', 'superadmin']) {
      profileRef.row = { user_id: UID, cms_role: role, withdrawal_status: 'none', deleted_at: null }
      const r = await call()
      expect(r.status).toBe(403)
    }
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('삭제된 계정·탈회 완전삭제·탈회 신청(유예) 계정·익명화 이메일은 409', async () => {
    profileRef.row = { user_id: UID, cms_role: null, withdrawal_status: 'none', deleted_at: '2026-10-01T00:00:00Z' }
    expect((await call()).status).toBe(409)
    profileRef.row = { user_id: UID, cms_role: null, withdrawal_status: 'purged', deleted_at: null }
    expect((await call()).status).toBe(409)
    profileRef.row = { user_id: UID, cms_role: null, withdrawal_status: 'requested', deleted_at: null }
    expect((await call()).status).toBe(409)
    profileRef.row = { user_id: UID, cms_role: null, withdrawal_status: 'none', deleted_at: null }
    getUserById.mockResolvedValue({ data: { user: { id: UID, email: 'purged-abc@purged.crazyshot.kr' } }, error: null })
    expect((await call()).status).toBe(409)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('로그인 계정(auth)을 찾지 못하면 404', async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found' } })
    expect((await call()).status).toBe(404)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('정상: auth 계정의 이메일로 recovery 링크를 만들고 token_hash URL을 돌려준다 — 메일은 보내지 않는다', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(generateLink).toHaveBeenCalledTimes(1)
    expect(generateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'customer@example.com' })
    expect(r.data.ok).toBe(true)
    expect(r.data.link).toBe('https://www.crazyshot.kr/auth/reset-password?token_hash=HASHED123&type=recovery')
    expect(r.headers['Cache-Control']).toBe('no-store')
  })

  it('감사로그에 발행 사실만 남기고 링크·토큰은 기록하지 않는다', async () => {
    await call()
    expect(audit).toHaveBeenCalledTimes(1)
    const entry = audit.mock.calls[0][1] as { actorId: string; actionType: string; targetUserId: string }
    expect(entry.actorId).toBe('admin-uid')
    expect(entry.actionType).toBe('password_recovery_issued')
    expect(entry.targetUserId).toBe(UID)
    expect(JSON.stringify(audit.mock.calls)).not.toContain('HASHED123')
  })

  it('링크 생성에 실패하면 500 — 감사로그를 남기지 않고 오류 상세를 노출하지 않는다', async () => {
    generateLink.mockResolvedValue({ data: null, error: { message: 'secret internal detail' } })
    const r = await call()
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.data)).not.toContain('secret internal detail')
    expect(audit).not.toHaveBeenCalled()
  })

  it('생성 결과에 token_hash가 없으면 500', async () => {
    generateLink.mockResolvedValue({ data: { properties: {} }, error: null })
    expect((await call()).status).toBe(500)
    expect(audit).not.toHaveBeenCalled()
  })

  it('발급자가 1시간에 10건을 넘기면 429 — 링크를 만들지 않는다', async () => {
    logRef.mine = Array.from({ length: 10 }, (_, i) => ({ created_at: new Date(Date.now() - (i + 1) * 60 * 1000).toISOString() }))
    const r = await call()
    expect(r.status).toBe(429)
    expect(generateLink).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('발급자가 하루에 30건을 넘기면(시간당 한도 이내라도) 429', async () => {
    logRef.mine = Array.from({ length: 30 }, (_, i) => ({ created_at: new Date(Date.now() - (2 + i * 0.5) * 60 * 60 * 1000).toISOString() }))
    expect((await call()).status).toBe(429)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('한도 이내(시간당 9건)면 발행된다', async () => {
    logRef.mine = Array.from({ length: 9 }, (_, i) => ({ created_at: new Date(Date.now() - (i + 1) * 60 * 1000).toISOString() }))
    expect((await call()).status).toBe(200)
  })

  it('같은 고객에게 5분 안에 다시 발행하면 429', async () => {
    logRef.target = [{ created_at: new Date(Date.now() - 60 * 1000).toISOString() }]
    expect((await call()).status).toBe(429)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('발행 이력 조회가 실패하면 안전하게 거절(500) — 링크를 만들지 않는다', async () => {
    logRef.error = { message: 'db down' }
    expect((await call()).status).toBe(500)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('감사 기록에 실패하면 링크를 돌려주지 않는다(500, fail-closed) — 관리자 알림도 보내지 않는다', async () => {
    auditOk.value = false
    const r = await call()
    expect(r.status).toBe(500)
    expect(r.data.link).toBeUndefined()
    expect(JSON.stringify(r.data)).not.toContain('HASHED123')
    expect(pushAdmins).not.toHaveBeenCalled()
  })

  it('발행하면 관리자 푸시를 보낸다 — 이메일은 가려서, 링크·토큰은 넣지 않는다', async () => {
    await call()
    expect(pushAdmins).toHaveBeenCalledTimes(1)
    const [key, payload] = pushAdmins.mock.calls[0] as [string, { title: string; body: string; link?: string }]
    expect(key).toBe('identity_review')
    expect(payload.body).toContain('cu***@example.com')
    expect(payload.body).not.toContain('customer@example.com')
    expect(JSON.stringify(payload)).not.toContain('HASHED123')
    expect(payload.link).toBe(`/cms/customers?selected=${UID}`)
  })

  it('집계 조회의 필터가 정확하다 — 발급자·행동 종류·기간·상한, 같은 고객 5분', async () => {
    await call()
    const mine = logCalls.find((c) => c.which === 'mine')!
    expect(mine.eq).toContainEqual(['user_id', 'admin-uid'])
    expect(mine.eq).toContainEqual(['action_type', 'password_recovery_issued'])
    expect(mine.limit).toBe(31)
    const dayAgo = Date.now() - new Date(mine.gte[0][1]).getTime()
    expect(dayAgo).toBeGreaterThan(24 * 60 * 60 * 1000 - 5000)
    expect(dayAgo).toBeLessThan(24 * 60 * 60 * 1000 + 5000)
    const target = logCalls.find((c) => c.which === 'target')!
    expect(target.eq).toContainEqual(['target_user_id', UID])
    expect(target.eq).toContainEqual(['action_type', 'password_recovery_issued'])
    const fiveMin = Date.now() - new Date(target.gte[0][1]).getTime()
    expect(fiveMin).toBeGreaterThan(5 * 60 * 1000 - 5000)
    expect(fiveMin).toBeLessThan(5 * 60 * 1000 + 5000)
  })

  it('1시간보다 오래된 이력은 시간당 한도에 세지 않는다(하루 한도 이내)', async () => {
    logRef.mine = Array.from({ length: 12 }, (_, i) => ({ created_at: new Date(Date.now() - (61 + i) * 60 * 1000).toISOString() }))
    expect((await call()).status).toBe(200)
  })

  it('로그인 계정에 이메일이 없으면 409 — 링크를 만들지 않는다', async () => {
    getUserById.mockResolvedValue({ data: { user: { id: UID, email: '' } }, error: null })
    expect((await call()).status).toBe(409)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('관리자 알림이 실패(throw)해도 발행은 유지된다', async () => {
    pushAdmins.mockRejectedValueOnce(new Error('fcm down'))
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.data.link).toContain('token_hash=HASHED123')
  })
})
