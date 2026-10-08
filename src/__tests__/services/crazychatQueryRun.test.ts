import { describe, it, expect, vi } from 'vitest'

// 실제 푸시 모듈(파이어베이스 등)을 불러오지 않는다 — 푸시는 deps.sendPush로 주입해 검증
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))

import { runCrazychatQuery, type QueryRunContext } from '$lib/server/crazychat/agent'
import { PROFILE_QUERY_COLUMNS, RESERVATION_QUERY_COLUMNS } from '$lib/server/crazychat/query'

/**
 * 크레이지챗 S2 — 조회형 실행기(권한·모드·안전 폴백)
 * DB는 가짜(admin 클라이언트)로 대체해 "무엇을 읽고 무엇을 쓰는지"를 호출 기록으로 검증한다.
 */
const USER = 'user-A'
const ON = { agent_enabled: true, query_enabled: true, query_observe: false }
const OBSERVE = { agent_enabled: true, query_enabled: false, query_observe: true }

const resRow = (o: Record<string, unknown> = {}) => ({
  id: 1, reservation_code: 'CS2610001', status: 'confirmed', start_date: '2026-10-10', end_date: '2026-10-12',
  return_time: '18:00', payment_confirmed_at: '2026-10-08T00:00:00Z', created_at: '2026-10-07T00:00:00Z', ...o,
})

interface Cfg {
  settings?: Record<string, unknown> | null
  settingsError?: boolean
  reservations?: unknown[] | 'error'
  profile?: Record<string, unknown> | null
  insertError?: boolean
  observationError?: boolean
}

function fakeAdmin(cfg: Cfg) {
  const calls: Array<{ table: string; op: string; cols?: string; filters: Record<string, unknown>; row?: unknown }> = []
  const from = (table: string) => {
    const rec = { table, op: 'select', cols: undefined as string | undefined, filters: {} as Record<string, unknown>, row: undefined as unknown }
    const qb: Record<string, unknown> = {}
    const finish = (): Promise<{ data: unknown; error: { message: string } | null }> => {
      calls.push({ ...rec })
      if (table === 'crazychat_settings') return Promise.resolve(cfg.settingsError ? { data: null, error: { message: 'x' } } : { data: cfg.settings ?? null, error: null })
      if (table === 'rental_reservations') return Promise.resolve(cfg.reservations === 'error' ? { data: null, error: { message: 'db' } } : { data: cfg.reservations ?? [], error: null })
      if (table === 'user_profiles') return Promise.resolve({ data: cfg.profile ?? null, error: null })
      if (table === 'chat_messages') return Promise.resolve(cfg.insertError ? { data: null, error: { message: 'ins' } } : { data: { id: 'm-ai', session_id: 's1', sender_type: 'ai', content: (rec.row as { content: string }).content }, error: null })
      if (table === 'crazychat_query_observations') return Promise.resolve(cfg.observationError ? { data: null, error: { message: 'obs' } } : { data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    }
    qb.select = (cols: string) => { if (rec.op === 'select') rec.cols = cols; return qb }
    qb.eq = (c: string, v: unknown) => { rec.filters[c] = v; return qb }
    qb.order = () => qb
    qb.limit = () => qb
    qb.maybeSingle = () => finish()
    qb.single = () => finish()
    qb.insert = (row: unknown) => { rec.op = 'insert'; rec.row = row; return table === 'chat_messages' ? qb : finish() }
    qb.update = (row: unknown) => { rec.op = 'update'; rec.row = row; return qb }
    qb.then = (resolve: (v: unknown) => unknown) => finish().then(resolve)
    return qb
  }
  return { admin: { from } as never, calls }
}

const ctx = (content: string, o: Partial<QueryRunContext> = {}): QueryRunContext => ({
  userId: USER, sessionId: 's1', messageId: 'msg-1', content, adminEngaged: false, ...o,
})
const reads = (calls: ReturnType<typeof fakeAdmin>['calls'], table: string) => calls.filter((c) => c.table === table && c.op === 'select')
const sendPush = () => vi.fn().mockResolvedValue(undefined)

describe('꺼져 있으면 아무것도 읽지 않는다', () => {
  it('기본 설정(전부 OFF)', async () => {
    const { admin, calls } = fakeAdmin({ settings: null, reservations: [resRow()] })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })
    expect(r.handled).toBe(false)
    expect(reads(calls, 'rental_reservations')).toHaveLength(0)
  })
  it('마스터 OFF면 조회가 켜져 있어도 정지', async () => {
    const { admin, calls } = fakeAdmin({ settings: { ...ON, agent_enabled: false }, reservations: [resRow()] })
    expect((await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })).handled).toBe(false)
    expect(reads(calls, 'rental_reservations')).toHaveLength(0)
  })
  it('설정 조회 실패면 전부 꺼짐', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin, calls } = fakeAdmin({ settingsError: true, reservations: [resRow()] })
    expect((await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })).handled).toBe(false)
    expect(reads(calls, 'rental_reservations')).toHaveLength(0)
    spy.mockRestore()
  })
})

describe('조회 대상이 아니면 읽지 않는다', () => {
  for (const [name, msg] of [
    ['사람 전용 주제(환불)', '환불 결제 완료됐나요'],
    ['허용 밖 항목(금액)', '내 예약 금액 알려줘'],
    ['방법 질문', '예약은 어떻게 하나요?'],
    ['일상 대화', '안녕하세요'],
    ['타인 정보 요청', '다른 사람 예약 상태 확인해줘'],
  ] as const) {
    it(name, async () => {
      const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()], profile: {} })
      expect((await runCrazychatQuery(admin, ctx(msg), { sendPush: sendPush() })).handled).toBe(false)
      expect(reads(calls, 'rental_reservations')).toHaveLength(0)
      expect(reads(calls, 'user_profiles')).toHaveLength(0)
    })
  }
  it('관리자가 이미 응대 중인 세션에서는 끼어들지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    expect((await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘', { adminEngaged: true }), { sendPush: sendPush() })).handled).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('켜짐(on) 모드', () => {
  it('본인 예약을 읽어 문장 틀로 답하고, 푸시를 보내고, 기록을 남긴다', async () => {
    const push = sendPush()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: push })
    expect(r.handled).toBe(true)
    const ins = calls.find((c) => c.table === 'chat_messages' && c.op === 'insert')
    expect(ins?.row).toMatchObject({ session_id: 's1', sender_type: 'ai', message_type: 'text' })
    expect((ins?.row as { content: string }).content).toContain('계약 완료')
    expect(push).toHaveBeenCalledTimes(1)
    const obs = calls.find((c) => c.table === 'crazychat_query_observations')
    expect(obs?.row).toMatchObject({ message_id: 'msg-1', mode: 'on', intent: 'reservation_status', outcome: 'answered', group_count: 1 })
  })
  it('예약 조회는 항상 세션 소유자 user_id로만, 허용된 컬럼만 읽는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    await runCrazychatQuery(admin, ctx('반납일이 언제예요?'), { sendPush: sendPush() })
    const q = reads(calls, 'rental_reservations')
    expect(q).toHaveLength(1)
    expect(q[0].filters).toEqual({ user_id: USER })
    expect(q[0].cols).toBe(RESERVATION_QUERY_COLUMNS)
    expect(q[0].cols).not.toMatch(/amount|price|address|phone|note|tracking|locker|dhero/i)
  })
  it('서류 조회는 본인 프로필의 허용 컬럼만 읽는다', async () => {
    const { admin, calls } = fakeAdmin({
      settings: ON,
      profile: { identity_doc_url: ['a'], identity_type: ['resident', 'resident_copy'], identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z' },
    })
    const r = await runCrazychatQuery(admin, ctx('서류 승인됐나요?'), { sendPush: sendPush() })
    expect(r.handled).toBe(true)
    const q = reads(calls, 'user_profiles')
    expect(q[0].filters).toEqual({ user_id: USER })
    expect(q[0].cols).toBe(PROFILE_QUERY_COLUMNS)
    expect(calls.find((c) => c.table === 'chat_messages')?.row).toMatchObject({ content: expect.stringContaining('승인이 완료') })
  })
  it('타인의 예약번호를 말하면 답하지 않고(존재 여부도 숨김) not_found로만 기록한다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ reservation_code: 'CS2610001' })] })
    const r = await runCrazychatQuery(admin, ctx('CS9999999 예약 상태 확인해줘'), { sendPush: sendPush() })
    expect(r.handled).toBe(false)
    expect(calls.find((c) => c.table === 'chat_messages')).toBeUndefined()
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ outcome: 'not_found', group_count: 0 })
    expect(JSON.stringify(calls.map((c) => c.row))).not.toContain('CS9999999')
  })
  it('예약이 하나도 없으면(비회원 포함) 답하지 않고 no_data로 기록', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [] })
    expect((await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })).handled).toBe(false)
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ outcome: 'no_data' })
  })
  it('프로필이 없는 비회원의 서류 조회는 답하지 않는다', async () => {
    const { admin } = fakeAdmin({ settings: ON, profile: null })
    expect((await runCrazychatQuery(admin, ctx('서류 승인됐나요?'), { sendPush: sendPush() })).handled).toBe(false)
  })
})

describe('관찰(observe) 모드 — 고객에게 보내지 않는다', () => {
  it('판정만 기록하고 메시지·푸시는 없다', async () => {
    const push = sendPush()
    const { admin, calls } = fakeAdmin({ settings: OBSERVE, reservations: [resRow()] })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: push })
    expect(r.handled).toBe(false)
    expect(calls.find((c) => c.table === 'chat_messages')).toBeUndefined()
    expect(push).not.toHaveBeenCalled()
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ mode: 'observe', outcome: 'answered' })
  })
})

describe('실패해도 고객 채팅을 막지 않는다', () => {
  it('예약 읽기 오류 → 던지지 않고 처리 안 함 + error 기록', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: 'error' })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })
    expect(r.handled).toBe(false)
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ outcome: 'error' })
    spy.mockRestore()
  })
  it('답변 저장 오류 → 처리 안 함(고객에게는 기존 흐름이 이어진다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const push = sendPush()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()], insertError: true })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: push })
    expect(r.handled).toBe(false)
    expect(push).not.toHaveBeenCalled()
    // 저장에 실패했으면 기록도 answered가 아니라 error로 남는다(실제 발송 결과와 일치)
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ outcome: 'error' })
    spy.mockRestore()
  })
  it('관찰 기록 저장이 실패해도 답변은 나간다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = fakeAdmin({ settings: ON, reservations: [resRow()], observationError: true })
    expect((await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: sendPush() })).handled).toBe(true)
    spy.mockRestore()
  })
  it('푸시가 실패해도 답변은 유효하다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    const r = await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: vi.fn().mockRejectedValue(new Error('push')) })
    expect(r.handled).toBe(true)
    spy.mockRestore()
  })
})

describe('sp3-qa(S2) 보완', () => {
  it('예약번호를 여러 개 말하면 추측하지 않고 넘긴다(어느 것을 묻는지 알 수 없음)', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ reservation_code: 'CS2610001' })] })
    const r = await runCrazychatQuery(admin, ctx('CS2610001 CS2619999 예약 상태 확인해줘'), { sendPush: sendPush() })
    expect(r.handled).toBe(false)
    expect(calls.find((c) => c.table === 'chat_messages')).toBeUndefined()
    expect(calls.find((c) => c.table === 'crazychat_query_observations')?.row).toMatchObject({ outcome: 'not_found' })
  })
  it('푸시 본문에는 예약번호·상태를 싣지 않는다(잠금화면 노출 방지)', async () => {
    const push = sendPush()
    const { admin } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    await runCrazychatQuery(admin, ctx('내 예약 상태 확인해줘'), { sendPush: push })
    const [, , payload] = push.mock.calls[0] as [string, string, { body: string }]
    expect(payload.body).not.toMatch(/CS2610001|계약|결제|상태/)
  })
  it('결제 안 된 문의는 읽지도 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    expect((await runCrazychatQuery(admin, ctx('결제했는데 예약이 확정이 안 됐어요'), { sendPush: sendPush() })).handled).toBe(false)
    expect(reads(calls, 'rental_reservations')).toHaveLength(0)
  })
})
