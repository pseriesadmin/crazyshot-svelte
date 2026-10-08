import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(), sendUrgentChatAdminPush: vi.fn(), sendPushToAdmins: vi.fn(), sendCrazychatRequestAdminPush: vi.fn() }))

import { runCrazychatAgent } from '$lib/server/crazychat/agent'
import { runCrazychatAction } from '$lib/server/crazychat/action-runner'
import type { QueryRunContext, RunDeps } from '$lib/server/crazychat/shared'

/**
 * 크레이지챗 S3 — 접수형 실행기
 * 핵심: 에이전트는 chat_agent_requests에만 쓴다(예약·결제·계약 테이블 쓰기 없음). 꺼짐·관찰·실패·타인 번호·중복을 모두 안전하게 처리.
 * DB는 가짜 admin으로 대체해 호출 기록으로 검증한다.
 */
const USER = 'user-A'
const ON = { agent_enabled: true, action_enabled: true, action_observe: false }
const OBSERVE = { agent_enabled: true, action_enabled: false, action_observe: true }
const resRow = (o: Record<string, unknown> = {}) => ({
  id: 1, reservation_code: 'CS2610001', status: 'confirmed', start_date: '2026-10-10', end_date: '2026-10-12',
  return_time: '18:00', payment_confirmed_at: '2026-10-08T00:00:00Z', created_at: '2026-10-07T00:00:00Z', ...o,
})
const approvedProfile = { identity_doc_url: ['a'], identity_type: ['resident', 'resident_copy'], identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z' }
const pendingProfile = { ...approvedProfile, identity_approved_at: null }
const emptyProfile = { identity_doc_url: [], identity_type: [] }

interface Cfg {
  settings?: Record<string, unknown> | null
  reservations?: unknown[] | 'error'
  profile?: Record<string, unknown> | null
  requestInsert?: 'ok' | 'dup' | 'error'
  messageInsertError?: boolean
}
type Call = { table: string; op: string; cols?: string; filters: Record<string, unknown>; row?: unknown }

function fakeAdmin(cfg: Cfg) {
  const calls: Call[] = []
  const from = (table: string) => {
    const rec: Call = { table, op: 'select', cols: undefined, filters: {}, row: undefined }
    const qb: Record<string, unknown> = {}
    const finish = (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
      calls.push({ ...rec })
      if (table === 'crazychat_settings') return Promise.resolve({ data: cfg.settings ?? null, error: null })
      if (table === 'rental_reservations') return Promise.resolve(cfg.reservations === 'error' ? { data: null, error: { message: 'db' } } : { data: cfg.reservations ?? [], error: null })
      if (table === 'user_profiles') return Promise.resolve({ data: cfg.profile ?? null, error: null })
      if (table === 'chat_agent_requests') {
        if (cfg.requestInsert === 'dup') return Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } })
        if (cfg.requestInsert === 'error') return Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } })
        return Promise.resolve({ data: null, error: null })
      }
      if (table === 'chat_messages') {
        const row = rec.row as { content: string; message_type: string; action_payload?: unknown }
        return Promise.resolve(cfg.messageInsertError ? { data: null, error: { message: 'ins' } } : { data: { id: 'm-ai', session_id: 's1', sender_type: 'ai', ...row }, error: null })
      }
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

const ctx = (content: string, o: Partial<QueryRunContext> = {}): QueryRunContext => ({ userId: USER, sessionId: 's1', messageId: 'msg-1', content, adminEngaged: false, ...o })
const mkDeps = () => ({ sendPush: vi.fn().mockResolvedValue(undefined), sendAdminPush: vi.fn().mockResolvedValue(undefined), sendUrgent: vi.fn().mockResolvedValue(undefined) })
const asDeps = (d: ReturnType<typeof mkDeps>): RunDeps => d as unknown as RunDeps
const ofTable = (calls: Call[], table: string, op?: string) => calls.filter((c) => c.table === table && (!op || c.op === op))
const obs = (calls: Call[]) => ofTable(calls, 'crazychat_query_observations', 'insert')[0]?.row

describe('꺼져 있으면 아무것도 하지 않는다', () => {
  it('기본 설정(전부 OFF)', async () => {
    const { admin, calls } = fakeAdmin({ settings: null, reservations: [resRow()] })
    const d = mkDeps()
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(false)
    expect(ofTable(calls, 'rental_reservations')).toHaveLength(0)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(d.sendAdminPush).not.toHaveBeenCalled()
  })
  it('마스터 OFF면 접수가 켜져 있어도 정지', async () => {
    const { admin, calls } = fakeAdmin({ settings: { ...ON, agent_enabled: false }, reservations: [resRow()] })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(mkDeps()))).handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
  })
  it('관리자가 이미 응대 중인 세션에서는 끼어들지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요', { adminEngaged: true }), asDeps(mkDeps()))).handled).toBe(false)
    expect(calls).toHaveLength(0)
  })
  for (const [name, msg] of [['사람 전용 주제', '예약 취소하고 시간 변경하고 싶어요'], ['방법 질문', '시간 변경 방법 알려주세요'], ['일상 대화', '안녕하세요']] as const) {
    it(`대상이 아니면 읽지도 쓰지도 않는다 — ${name}`, async () => {
      const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
      expect((await runCrazychatAction(admin, ctx(msg), asDeps(mkDeps()))).handled).toBe(false)
      expect(ofTable(calls, 'rental_reservations')).toHaveLength(0)
      expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    })
  }
})

describe('시간 변경·연장 접수(on)', () => {
  it('본인 예약을 확인해 접수 기록을 남기고, 고객에게 안내하고, 관리자에게 알린다', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ status: 'confirmed' })] })
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(true)
    const req = ofTable(calls, 'chat_agent_requests', 'insert')[0]
    expect(req.row).toEqual({ user_id: USER, session_id: 's1', message_id: 'msg-1', kind: 'time_change', reservation_code: 'CS2610001' })
    const msg = ofTable(calls, 'chat_messages', 'insert')[0]
    expect(msg.row).toMatchObject({ session_id: 's1', sender_type: 'ai', message_type: 'text' })
    expect((msg.row as { content: string }).content).toContain('접수')
    expect((msg.row as { content: string }).content).toContain('확정된 것은 아니')
    expect(d.sendAdminPush).toHaveBeenCalledTimes(1)
    expect(d.sendAdminPush.mock.calls[0][1]).toEqual({ kind: 'time_change', userId: USER, sessionId: 's1' })
    expect(obs(calls)).toMatchObject({ message_id: 'msg-1', mode: 'on', intent: 'time_change', outcome: 'registered', group_count: 1 })
  })
  it('접수는 예약·결제·계약·포인트 테이블에 어떤 쓰기도 하지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    await runCrazychatAction(admin, ctx('대여 연장하고 싶어요'), asDeps(mkDeps()))
    const writes = calls.filter((c) => c.op !== 'select').map((c) => c.table)
    for (const t of writes) expect(['chat_agent_requests', 'chat_messages', 'chat_sessions', 'crazychat_query_observations']).toContain(t)
    expect(writes).not.toContain('rental_reservations')
  })
  it('예약 조회는 세션 소유자 user_id로만, 허용된 컬럼만 읽는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    await runCrazychatAction(admin, ctx('대여 연장하고 싶어요'), asDeps(mkDeps()))
    const q = ofTable(calls, 'rental_reservations', 'select')
    expect(q[0].filters).toEqual({ user_id: USER })
    expect(q[0].cols).not.toMatch(/amount|price|address|phone|note|tracking|locker/i)
  })
  it('연장은 대여 중 예약에 접수된다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ status: 'in_use' })] })
    expect((await runCrazychatAction(admin, ctx('하루 더 연장하고 싶습니다'), asDeps(mkDeps()))).handled).toBe(true)
    expect(ofTable(calls, 'chat_agent_requests', 'insert')[0].row).toMatchObject({ kind: 'extend' })
  })
  it('접수할 수 없는 단계(예: 이미 대여 중인데 시간 변경)면 접수하지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ status: 'in_use' })] })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(mkDeps()))).handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(obs(calls)).toMatchObject({ outcome: 'no_data' })
  })
  it('타인의 예약번호를 말하면 접수하지 않고(존재 여부 숨김) 번호가 어디에도 저장되지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    const r = await runCrazychatAction(admin, ctx('CS9999999 예약 시간 변경하고 싶어요'), asDeps(mkDeps()))
    expect(r.handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(obs(calls)).toMatchObject({ outcome: 'not_found' })
    expect(JSON.stringify(calls.map((c) => c.row))).not.toContain('CS9999999')
  })
  it('예약이 여러 개인데 번호를 말하지 않으면 접수 대신 번호를 물어본다', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow({ reservation_code: 'CS2610001' }), resRow({ id: 2, reservation_code: 'CS2610002' })] })
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(true)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect((ofTable(calls, 'chat_messages', 'insert')[0].row as { content: string }).content).toContain('예약번호')
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    expect(obs(calls)).toMatchObject({ outcome: 'need_code' })
  })
  it('번호가 두 개 이상이면 추측하지 않고 넘긴다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    expect((await runCrazychatAction(admin, ctx('CS2610001 CS2610002 예약 시간 변경하고 싶어요'), asDeps(mkDeps()))).handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
  })
  it('이미 대기 중인 같은 요청이면(중복) 새로 만들지 않고 "이미 접수됐어요"로 안내, 관리자 푸시는 다시 보내지 않는다', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()], requestInsert: 'dup' })
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(true)
    expect((ofTable(calls, 'chat_messages', 'insert')[0].row as { content: string }).content).toContain('이미 접수')
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    expect(obs(calls)).toMatchObject({ outcome: 'duplicate' })
  })
})

describe('관찰(observe) 모드 — 접수·알림·고객 안내 없음', () => {
  it('판정만 기록한다', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: OBSERVE, reservations: [resRow()] })
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(ofTable(calls, 'chat_messages')).toHaveLength(0)
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    expect(obs(calls)).toMatchObject({ mode: 'observe', intent: 'time_change', outcome: 'registered' })
  })
})

describe('상담원 호출', () => {
  it('긴급 상담 표시(CS_ESCALATE 기록) + 긴급 푸시 + 고객 안내', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON })
    const r = await runCrazychatAction(admin, ctx('상담원 연결해 주세요'), asDeps(d))
    expect(r.handled).toBe(true)
    expect(ofTable(calls, 'chat_intent_logs', 'insert')[0].row).toMatchObject({ message_id: 'msg-1', intent: 'CS_ESCALATE' })
    expect(d.sendUrgent).toHaveBeenCalledWith(expect.anything(), 's1', USER)
    expect((ofTable(calls, 'chat_messages', 'insert')[0].row as { content: string }).content).toContain('상담원')
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(obs(calls)).toMatchObject({ intent: 'call_agent', outcome: 'registered' })
  })
  it('관찰 모드에서는 호출하지 않는다', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: OBSERVE })
    expect((await runCrazychatAction(admin, ctx('상담원 연결해 주세요'), asDeps(d))).handled).toBe(false)
    expect(d.sendUrgent).not.toHaveBeenCalled()
    expect(ofTable(calls, 'chat_intent_logs')).toHaveLength(0)
  })
})

describe('서류 재제출 안내(접수 아님 — 바로 안내)', () => {
  it('서류가 없으면 등록 요청 카드를 보낸다(기존 카드 모양)', async () => {
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, profile: emptyProfile })
    const r = await runCrazychatAction(admin, ctx('서류 다시 제출하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(true)
    const msg = ofTable(calls, 'chat_messages', 'insert')[0]
    expect(msg.row).toMatchObject({ message_type: 'action_card', action_payload: { type: 'identity_request', action_url: '/account/profile?tab=profile' } })
    expect(d.sendPush).toHaveBeenCalledWith(USER, 'identity_request', expect.anything())
    expect(ofTable(calls, 'user_profiles', 'select')[0].filters).toEqual({ user_id: USER })
  })
  it('확인 중이면 추가 제출 불필요 안내(카드 없음)', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, profile: pendingProfile })
    await runCrazychatAction(admin, ctx('서류 다시 제출하고 싶어요'), asDeps(mkDeps()))
    const row = ofTable(calls, 'chat_messages', 'insert')[0].row as { content: string; message_type: string }
    expect(row.message_type).toBe('text')
    expect(row.content).toContain('확인하는 중')
  })
  it('이미 승인됐으면 다시 제출할 필요 없다고 안내', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON, profile: approvedProfile })
    await runCrazychatAction(admin, ctx('서류 다시 제출하고 싶어요'), asDeps(mkDeps()))
    expect((ofTable(calls, 'chat_messages', 'insert')[0].row as { content: string }).content).toContain('이미 완료')
  })
  it('프로필이 없는 비회원이면 처리하지 않는다', async () => {
    const { admin } = fakeAdmin({ settings: ON, profile: null })
    expect((await runCrazychatAction(admin, ctx('서류 다시 제출하고 싶어요'), asDeps(mkDeps()))).handled).toBe(false)
  })
})

describe('실패해도 고객 채팅을 막지 않는다', () => {
  it('예약 읽기 오류 → 접수 없음·handled:false·error 기록', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: 'error' })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(mkDeps()))).handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(obs(calls)).toMatchObject({ outcome: 'error' })
    spy.mockRestore()
  })
  it('접수 저장 오류(중복이 아닌) → 안내·관리자 알림 없이 기존 흐름', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()], requestInsert: 'error' })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))).handled).toBe(false)
    expect(ofTable(calls, 'chat_messages')).toHaveLength(0)
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    expect(obs(calls)).toMatchObject({ outcome: 'error' })
    spy.mockRestore()
  })
  it('안내 메시지 저장이 실패해도 접수는 유지되고 관리자에게 알린다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = mkDeps()
    const { admin, calls } = fakeAdmin({ settings: ON, reservations: [resRow()], messageInsertError: true })
    const r = await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d))
    expect(r.handled).toBe(false)
    expect(ofTable(calls, 'chat_agent_requests', 'insert')).toHaveLength(1)
    expect(d.sendAdminPush).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('관리자 푸시가 실패해도 고객 안내는 나간다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = { ...mkDeps(), sendAdminPush: vi.fn().mockRejectedValue(new Error('push')) }
    const { admin } = fakeAdmin({ settings: ON, reservations: [resRow()] })
    expect((await runCrazychatAction(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(d as never))).handled).toBe(true)
    spy.mockRestore()
  })
})

describe('진입점 runCrazychatAgent — 조회형 우선, 설정은 한 번만 읽는다', () => {
  it('조회형이 처리하면 접수형은 실행되지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: { agent_enabled: true, query_enabled: true, action_enabled: true }, reservations: [resRow()] })
    const r = await runCrazychatAgent(admin, ctx('내 예약 상태 확인해줘'), asDeps(mkDeps()))
    expect(r.handled).toBe(true)
    expect(ofTable(calls, 'chat_agent_requests')).toHaveLength(0)
    expect(ofTable(calls, 'crazychat_settings')).toHaveLength(1)
  })
  it('조회 대상이 아니면 접수형이 처리한다', async () => {
    const { admin, calls } = fakeAdmin({ settings: { agent_enabled: true, query_enabled: true, action_enabled: true }, reservations: [resRow()] })
    const r = await runCrazychatAgent(admin, ctx('예약 시간 변경하고 싶어요'), asDeps(mkDeps()))
    expect(r.handled).toBe(true)
    expect(ofTable(calls, 'chat_agent_requests', 'insert')).toHaveLength(1)
    expect(ofTable(calls, 'crazychat_settings')).toHaveLength(1)
  })
  it('둘 다 아니면 handled:false', async () => {
    const { admin } = fakeAdmin({ settings: { agent_enabled: true, query_enabled: true, action_enabled: true } })
    expect((await runCrazychatAgent(admin, ctx('안녕하세요'), asDeps(mkDeps()))).handled).toBe(false)
  })
  it('관리자 응대 중이면 설정도 읽지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ settings: ON })
    expect((await runCrazychatAgent(admin, ctx('예약 시간 변경하고 싶어요', { adminEngaged: true }), asDeps(mkDeps()))).handled).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
