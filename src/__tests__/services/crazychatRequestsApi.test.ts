import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 크레이지챗 S3 — 관리자 접수 큐 API(GET 목록 · POST 처리) + 카드 구성
 *  · 상담 메뉴 권한 + 매니저 이상만(파트너 불가), 처리는 대기 건에만 1회
 *  · 에이전트가 만든 요청을 관리자가 닫는 것 외에 예약·결제·계약을 바꾸는 쓰기는 없다
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

const mockGate = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => mockGate(...a) }))
const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))

type Result = { data: unknown; error?: { message: string } | null }
interface Call { table: string; op: string; filters: Record<string, unknown>; row?: unknown }
let calls: Call[]
let cfg: { pending?: unknown[]; profiles?: unknown[]; reservations?: unknown[]; updateRows?: unknown[] | null; listError?: boolean }

function chain(table: string) {
  const rec: Call = { table, op: 'select', filters: {} }
  const qb: Record<string, unknown> = {}
  const finish = (): Promise<Result> => {
    calls.push({ ...rec })
    if (table === 'chat_agent_requests') {
      if (rec.op === 'update') return Promise.resolve({ data: cfg.updateRows ?? [], error: null })
      return Promise.resolve(cfg.listError ? { data: null, error: { message: 'db' } } : { data: cfg.pending ?? [], error: null })
    }
    if (table === 'user_profiles') return Promise.resolve({ data: cfg.profiles ?? [], error: null })
    if (table === 'rental_reservations') return Promise.resolve({ data: cfg.reservations ?? [], error: null })
    return Promise.resolve({ data: [], error: null })
  }
  qb.select = () => qb
  qb.eq = (c: string, v: unknown) => { rec.filters[c] = v; return qb }
  qb.in = (c: string, v: unknown) => { rec.filters[c] = v; return qb }
  qb.order = () => qb
  qb.limit = () => qb
  qb.update = (row: unknown) => { rec.op = 'update'; rec.row = row; return qb }
  qb.then = (resolve: (v: unknown) => unknown) => finish().then(resolve)
  return qb
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t) }) }))

const { GET } = await import('../../routes/api/cms/chat/agent-requests/+server')
const { POST } = await import('../../routes/api/cms/chat/agent-requests/[id]/resolve/+server')

const ADMIN = 'admin-1'
const locals = { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: ADMIN } } }) }
const UUID = '11111111-1111-4111-8111-111111111111'
type Res = { status: number; data: Record<string, unknown> }
const callGet = async () => (await GET({ locals } as never)) as unknown as Res
const callPost = async (id: string, body: unknown) =>
  (await POST({ locals, params: { id }, request: { json: async () => body } } as never)) as unknown as Res

const pendingRow = (o: Record<string, unknown> = {}) => ({
  id: UUID, created_at: '2026-10-07T01:00:00Z', user_id: 'u1', session_id: 's1', message_id: 'm1', kind: 'time_change', reservation_code: 'CS2610001', ...o,
})

beforeEach(() => {
  calls = []
  cfg = {}
  vi.clearAllMocks()
  mockGate.mockResolvedValue(null)
  mockRole.mockResolvedValue('manager')
  locals.safeGetSession.mockResolvedValue({ session: { user: { id: ADMIN } } })
})

describe('GET /api/cms/chat/agent-requests — 접수 목록', () => {
  it('메뉴 권한이 없으면 막는다(읽지 않음)', async () => {
    mockGate.mockResolvedValue({ status: 403, data: { error: 'x' } })
    const r = await callGet()
    expect(r.status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('CMS 역할이 없으면 401', async () => {
    mockRole.mockResolvedValue(null)
    expect((await callGet()).status).toBe(401)
  })
  it('파트너는 403(매니저 이상만)', async () => {
    mockRole.mockResolvedValue('partner')
    expect((await callGet()).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('상담 메뉴 키(consulting.chat)로 게이트를 호출한다', async () => {
    await callGet()
    expect(mockGate.mock.calls[0][1]).toBe('consulting.chat')
  })
  it('대기 건만 조회하고 고객 이름·예약 진행 단계를 붙여 카드로 돌려준다(원문·연락처 없음)', async () => {
    cfg.pending = [pendingRow()]
    cfg.profiles = [{ id: 'u1', full_name: '홍길동' }]
    cfg.reservations = [{ user_id: 'u1', reservation_code: 'CS2610001', status: 'confirmed', id: 1, start_date: null, end_date: null, return_time: null, payment_confirmed_at: null, created_at: '2026-10-01T00:00:00Z' }]
    const r = await callGet()
    expect(r.status).toBe(200)
    const list = r.data.requests as Array<Record<string, unknown>>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: UUID, kind: 'time_change', kind_label: '예약 시간 변경 요청', reservation_code: 'CS2610001', customer_name: '홍길동', session_id: 's1', reservation_stage: 'confirmed', reservation_closed: false })
    expect(JSON.stringify(list)).not.toMatch(/phone|email|address|연락처/)
    expect(calls.find((c) => c.table === 'chat_agent_requests')?.filters).toEqual({ status: 'pending' })
  })
  it('예약이 이미 취소·종료됐으면 reservation_closed 표시', async () => {
    cfg.pending = [pendingRow()]
    cfg.profiles = [{ id: 'u1', full_name: '홍길동' }]
    cfg.reservations = [{ user_id: 'u1', reservation_code: 'CS2610001', status: 'cancelled', id: 1, start_date: null, end_date: null, return_time: null, payment_confirmed_at: null, created_at: '2026-10-01T00:00:00Z' }]
    const list = (await callGet()).data.requests as Array<Record<string, unknown>>
    expect(list[0]).toMatchObject({ reservation_stage: 'cancelled', reservation_closed: true })
  })
  it('다른 고객의 같은 예약번호 행은 섞이지 않는다(요청한 고객의 예약만 본다)', async () => {
    cfg.pending = [pendingRow()]
    cfg.profiles = [{ id: 'u1', full_name: '홍길동' }]
    cfg.reservations = [{ user_id: 'OTHER', reservation_code: 'CS2610001', status: 'cancelled', id: 9, start_date: null, end_date: null, return_time: null, payment_confirmed_at: null, created_at: '2026-10-01T00:00:00Z' }]
    const list = (await callGet()).data.requests as Array<Record<string, unknown>>
    expect(list[0]).toMatchObject({ reservation_stage: null, reservation_closed: false })
  })
  it('접수가 없으면 빈 목록', async () => {
    expect((await callGet()).data).toEqual({ requests: [] })
  })
  it('DB 오류는 500', async () => {
    cfg.listError = true
    expect((await callGet()).status).toBe(500)
  })
})

describe('POST /api/cms/chat/agent-requests/[id]/resolve — 처리', () => {
  it('권한: 메뉴 게이트·역할·파트너 차단', async () => {
    mockGate.mockResolvedValue({ status: 403, data: { error: 'x' } })
    expect((await callPost(UUID, { status: 'done' })).status).toBe(403)
    mockGate.mockResolvedValue(null)
    mockRole.mockResolvedValue(null)
    expect((await callPost(UUID, { status: 'done' })).status).toBe(401)
    mockRole.mockResolvedValue('partner')
    expect((await callPost(UUID, { status: 'done' })).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('잘못된 id·상태는 400(쓰기 없음)', async () => {
    expect((await callPost('not-a-uuid', { status: 'done' })).status).toBe(400)
    expect((await callPost(UUID, { status: 'pending' })).status).toBe(400)
    expect((await callPost(UUID, { status: 'deleted' })).status).toBe(400)
    expect((await callPost(UUID, null)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
  it('대기 건을 처리 완료/반려로 바꾸고 처리자·시각을 남긴다 — 이 테이블 외에는 쓰지 않는다', async () => {
    cfg.updateRows = [{ id: UUID }]
    const r = await callPost(UUID, { status: 'done' })
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ ok: true })
    const upd = calls.filter((c) => c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].table).toBe('chat_agent_requests')
    expect(upd[0].row).toMatchObject({ status: 'done', resolved_by: ADMIN })
    expect(typeof (upd[0].row as { resolved_at: string }).resolved_at).toBe('string')
    expect(upd[0].filters).toEqual({ id: UUID, status: 'pending' })
    expect(calls.filter((c) => c.op !== 'select' && c.table !== 'chat_agent_requests')).toHaveLength(0)
  })
  it('반려도 같은 방식', async () => {
    cfg.updateRows = [{ id: UUID }]
    expect((await callPost(UUID, { status: 'rejected' })).status).toBe(200)
  })
  it('이미 처리됐거나 없는 건이면 404(두 번 처리 불가)', async () => {
    cfg.updateRows = []
    expect((await callPost(UUID, { status: 'done' })).status).toBe(404)
  })
  it('로그인 정보가 없으면 401', async () => {
    locals.safeGetSession.mockResolvedValue({ session: null })
    expect((await callPost(UUID, { status: 'done' })).status).toBe(401)
  })
})
