import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 크레이지챗 S5 — 설정 변경 API(GET/PUT)·초안 피드백 API: 권한(매니저 이상·슈퍼마스터 전용 항목)·감사 로그·쓰기 경계
 */
vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

const mockGate = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => mockGate(...a) }))
const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))
const mockAudit = vi.fn()
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: (...a: unknown[]) => mockAudit(...a) }))

interface Call { table: string; op: string; row?: Record<string, unknown>; filters: Record<string, unknown> }
let calls: Call[]
let settingsRow: Record<string, unknown>
let updateOk: boolean
let feedbackRows: unknown[]
let lockWins: boolean

const baseRow = () => ({
  agent_enabled: false, query_enabled: false, query_observe: false, action_enabled: false, action_observe: false,
  ai_fallback_enabled: false, ai_fallback_observe: false, ai_allowed_categories: [] as string[], updated_at: '2026-10-07T00:00:00Z', updated_by: 'someone',
})

function chain(table: string) {
  const rec: Call = { table, op: 'select', filters: {} }
  const qb: Record<string, unknown> = {}
  const finish = () => {
    calls.push({ ...rec })
    if (table === 'crazychat_settings') {
      if (rec.op === 'update') return Promise.resolve({ data: updateOk && lockWins ? [{ id: true }] : [], error: updateOk ? null : { message: 'x' } })
      return Promise.resolve({ data: settingsRow, error: null })
    }
    if (table === 'user_profiles') return Promise.resolve({ data: { full_name: '관리자', email: 'a@b.c' }, error: null })
    if (table === 'ai_reply_observations') return Promise.resolve({ data: feedbackRows, error: null })
    return Promise.resolve({ data: [], error: null })
  }
  qb.select = () => qb
  qb.limit = () => qb
  qb.maybeSingle = () => finish()
  qb.eq = (c: string, v: unknown) => { rec.filters[c] = v; return qb }
  qb.update = (row: Record<string, unknown>) => { rec.op = 'update'; rec.row = row; return qb }
  qb.then = (resolve: (v: unknown) => unknown) => finish().then(resolve)
  return qb
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t) }) }))

const settingsMod = await import('../../routes/api/cms/chat/crazychat/settings/+server')
const feedbackMod = await import('../../routes/api/cms/chat/crazychat/drafts/[id]/feedback/+server')

const ADMIN = 'admin-1'
const locals = { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: ADMIN } } }) }
type Res = { status: number; data: Record<string, unknown> }
const get = async () => (await settingsMod.GET({ locals } as never)) as unknown as Res
const put = async (body: unknown) => (await settingsMod.PUT({ locals, request: { json: async () => body } } as never)) as unknown as Res
const UUID = '11111111-1111-4111-8111-111111111111'
const fb = async (id: string, body: unknown) => (await feedbackMod.POST({ locals, params: { id }, request: { json: async () => body } } as never)) as unknown as Res
const writes = () => calls.filter((c) => c.op === 'update')

beforeEach(() => {
  calls = []; settingsRow = baseRow(); updateOk = true; lockWins = true; feedbackRows = [{ id: UUID }]
  vi.clearAllMocks()
  mockGate.mockResolvedValue(null)
  mockRole.mockResolvedValue('manager')
  locals.safeGetSession.mockResolvedValue({ session: { user: { id: ADMIN } } })
})

describe('GET settings', () => {
  it('메뉴 권한·역할이 없거나 파트너면 읽지 않고 거절', async () => {
    mockGate.mockResolvedValue({ status: 403, data: { error: 'x' } })
    expect((await get()).status).toBe(403)
    mockGate.mockResolvedValue(null); mockRole.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    mockRole.mockResolvedValue('partner')
    expect((await get()).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('단계로 변환해 돌려주고 변경자 이름·슈퍼마스터 여부를 알려준다', async () => {
    settingsRow = { ...baseRow(), agent_enabled: true, query_observe: true, ai_fallback_enabled: true }
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ settings: { agent_enabled: true, query: 'observe', action: 'off', ai_fallback: 'on' }, updated_by_name: '관리자', can_enable_live: false })
    mockRole.mockResolvedValue('superadmin')
    expect((await get()).data.can_enable_live).toBe(true)
  })
  it('메뉴 게이트는 consulting.crazychat 키', async () => {
    await get()
    expect(mockGate.mock.calls[0][1]).toBe('consulting.crazychat')
  })
})

describe('PUT settings', () => {
  it('권한: 게이트·역할·파트너·로그인 없음', async () => {
    mockGate.mockResolvedValue({ status: 403, data: { error: 'x' } })
    expect((await put({ query: 'observe' })).status).toBe(403)
    mockGate.mockResolvedValue(null); mockRole.mockResolvedValue('partner')
    expect((await put({ query: 'observe' })).status).toBe(403)
    mockRole.mockResolvedValue('manager'); locals.safeGetSession.mockResolvedValue({ session: null })
    expect((await put({ query: 'observe' })).status).toBe(401)
    expect(writes()).toHaveLength(0)
  })
  it('잘못된 요청은 400(쓰기 없음)', async () => {
    for (const b of [null, {}, { query: 'x' }, { ai_allowed_categories: ['damage'] }]) expect((await put(b)).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('매니저는 조회형을 관찰로 바꿀 수 있고 변경자·감사 로그가 남는다', async () => {
    const r = await put({ query: 'observe' })
    expect(r.status).toBe(200)
    const w = writes()
    expect(w).toHaveLength(1)
    expect(w[0].table).toBe('crazychat_settings')
    expect(w[0].row).toMatchObject({ query_observe: true, query_enabled: false, updated_by: ADMIN })
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit.mock.calls[0][1]).toMatchObject({
      actorId: ADMIN, actionType: 'crazychat_setting_change', targetUserId: null,
      beforeValue: { query: 'off' }, afterValue: { query: 'observe' },
    })
  })
  it('매니저는 마스터를 켤 수 없다(슈퍼마스터 전용)', async () => {
    const r = await put({ agent_enabled: true })
    expect(r.status).toBe(403)
    expect(writes()).toHaveLength(0)
    expect(mockAudit).not.toHaveBeenCalled()
  })
  it('매니저는 AI를 켜짐으로 바꿀 수 없지만 관찰·꺼짐은 가능', async () => {
    expect((await put({ ai_fallback: 'on' })).status).toBe(403)
    expect((await put({ ai_fallback: 'observe' })).status).toBe(200)
  })
  it('슈퍼마스터는 마스터·AI 켜짐 모두 가능', async () => {
    mockRole.mockResolvedValue('superadmin')
    expect((await put({ agent_enabled: true, ai_fallback: 'on' })).status).toBe(200)
    expect(writes()[0].row).toMatchObject({ agent_enabled: true, ai_fallback_enabled: true, updated_by: ADMIN })
  })
  it('마스터 끄기는 매니저도 가능(비상 정지)', async () => {
    settingsRow = { ...baseRow(), agent_enabled: true, ai_fallback_enabled: true }
    const r = await put({ agent_enabled: false })
    expect(r.status).toBe(200)
    expect(writes()[0].row).toMatchObject({ agent_enabled: false })
  })
  it('AI가 켜진 동안 허용 분류 변경은 슈퍼마스터 전용', async () => {
    settingsRow = { ...baseRow(), agent_enabled: true, ai_fallback_enabled: true, ai_allowed_categories: ['general'] }
    expect((await put({ ai_allowed_categories: ['general', 'return'] })).status).toBe(403)
    mockRole.mockResolvedValue('superadmin')
    expect((await put({ ai_allowed_categories: ['general', 'return'] })).status).toBe(200)
  })
  it('같은 값으로 저장하면 쓰기·감사 없음', async () => {
    const r = await put({ query: 'off' })
    expect(r.data).toMatchObject({ ok: true, unchanged: true })
    expect(writes()).toHaveLength(0)
    expect(mockAudit).not.toHaveBeenCalled()
  })
  it('읽은 뒤 다른 관리자가 먼저 바꿨으면(낙관적 잠금 실패) 409 — 옛 값으로 덮어쓰지 않고 감사도 남기지 않는다', async () => {
    lockWins = false
    const r = await put({ query: 'observe' })
    expect(r.status).toBe(409)
    expect(mockAudit).not.toHaveBeenCalled()
  })
  it('쓸 때 읽은 updated_at을 조건으로 건다', async () => {
    await put({ query: 'observe' })
    expect(writes()[0].filters).toMatchObject({ id: true, updated_at: '2026-10-07T00:00:00Z' })
  })
  it('저장 실패면 500이고 감사 로그를 남기지 않는다', async () => {
    updateOk = false
    expect((await put({ query: 'observe' })).status).toBe(500)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})

describe('POST drafts/[id]/feedback', () => {
  it('권한 거절·잘못된 값은 쓰기 없음', async () => {
    mockGate.mockResolvedValue({ status: 403, data: { error: 'x' } })
    expect((await fb(UUID, { feedback: 1 })).status).toBe(403)
    mockGate.mockResolvedValue(null); mockRole.mockResolvedValue('partner')
    expect((await fb(UUID, { feedback: 1 })).status).toBe(403)
    mockRole.mockResolvedValue('manager')
    expect((await fb('bad', { feedback: 1 })).status).toBe(400)
    for (const b of [null, {}, { feedback: 2 }, { feedback: 'y' }]) expect((await fb(UUID, b)).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('정답·오답은 검토자와 시각을 남기고 보류는 지운다 — 답변된 초안에만 적용', async () => {
    expect((await fb(UUID, { feedback: 1 })).status).toBe(200)
    expect(writes()[0].row).toMatchObject({ feedback: 1, feedback_by: ADMIN })
    expect(writes()[0].filters).toEqual({ id: UUID, outcome: 'answered' })
    await fb(UUID, { feedback: null })
    expect(writes()[1].row).toEqual({ feedback: null, feedback_by: null, feedback_at: null })
    expect(writes().every((w) => w.table === 'ai_reply_observations')).toBe(true)
  })
  it('대상이 없으면 404', async () => {
    feedbackRows = []
    expect((await fb(UUID, { feedback: 0 })).status).toBe(404)
  })
})
