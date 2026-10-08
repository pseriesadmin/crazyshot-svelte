import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAiFallback, type ModelCaller } from '$lib/server/crazychat/ai-fallback'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

/** 크레이지챗 S4 — AI 폴백 실행기: 꺼짐·관찰·켜짐 모드, 상한, 근거 밖 답변 차단, 쓰기 경계 */
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))

interface Cfg {
  canned?: unknown[]; policy?: unknown[]; counts?: { minute?: number; day?: number; session?: number }
  recent?: Array<{ outcome: string; created_at: string }>; failCount?: boolean; failCanned?: boolean; insertFail?: boolean
}
let cfg: Cfg
let writes: Array<{ table: string; op: string; row: Record<string, unknown> }>
let obsState: Record<string, unknown> | null
let deletedObs: number
let countCalls: number

function makeAdmin() {
  return {
    from(table: string) {
      const st: { count: boolean; session: boolean; orderLimit: boolean } = { count: false, session: false, orderLimit: false }
      const qb: Record<string, unknown> = {}
      const done = () => {
        if (table === 'ai_reply_observations') {
          if (st.count) {
            countCalls++
            if (cfg.failCount) return { count: null, error: { message: 'db' } }
            const c = cfg.counts ?? {}
            return { count: st.session ? (c.session ?? 0) : (countCalls === 1 ? (c.minute ?? 0) : (c.day ?? 0)), error: null }
          }
          return { data: cfg.recent ?? [], error: null }
        }
        if (table === 'canned_responses') return cfg.failCanned ? { data: null, error: { message: 'db' } } : { data: cfg.canned ?? [], error: null }
        if (table === 'crazychat_policy_snippets') return { data: cfg.policy ?? [], error: null }
        return { data: [], error: null }
      }
      qb.select = (_c: string, o?: { count?: string }) => { if (o?.count) st.count = true; return qb }
      for (const m of ['gte', 'order', 'limit']) qb[m] = () => qb
      qb.eq = (c: string) => { if (c === 'session_id') st.session = true; return qb }
      qb.insert = (row: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', row })
        if (table === 'ai_reply_observations' && !cfg.insertFail) obsState = { ...row }
        if (table === 'chat_messages') return { select: () => ({ single: async () => ({ data: { id: 'ai-msg', sender_type: 'ai', ...row }, error: null }) }) }
        return Promise.resolve({ error: cfg.insertFail && table === 'ai_reply_observations' ? { message: 'x' } : null })
      }
      qb.update = (row: Record<string, unknown>) => {
        writes.push({ table, op: 'update', row })
        if (table === 'ai_reply_observations' && obsState) obsState = { ...obsState, ...row }
        return { eq: async () => ({ error: null }) }
      }
      qb.delete = () => ({ eq: async () => { if (table === 'ai_reply_observations') { deletedObs++; obsState = null } return { error: null } } })
      qb.neq = () => qb
      qb.then = (resolve: (v: unknown) => unknown) => Promise.resolve(done()).then(resolve)
      return qb
    },
  }
}

const settings = (o: Partial<{ enabled: boolean; observe: boolean; cats: string[] }> = {}): CrazychatSettings => ({
  ...ALL_OFF, agentEnabled: true,
  aiFallback: { enabled: o.enabled ?? false, observe: o.observe ?? false }, aiAllowedCategories: o.cats ?? [],
})
const CANNED = [{ id: 'c1', title: '배송비 안내', content: '크레이지배송 편도 3,000원입니다.', category: 'delivery' }]
const ctx = { userId: 'u1', sessionId: 's1', messageId: 'm1', content: '배송비가 얼마인가요?', adminEngaged: false }
const reply = (o: Record<string, unknown> = {}): ModelCaller => vi.fn().mockResolvedValue({
  text: JSON.stringify({ decline: false, answer: '편도 3,000원이에요.', sources: ['S1'], confidence: 0.9, ...o }), inputTokens: 500, outputTokens: 40,
})
const obsRows = () => (obsState ? [obsState] : [])
const msgRows = () => writes.filter((w) => w.table === 'chat_messages')

beforeEach(() => { cfg = { canned: CANNED }; writes = []; countCalls = 0; obsState = null; deletedObs = 0 })

describe('runAiFallback', () => {
  it('꺼져 있으면 아무것도 읽거나 호출하지 않는다', async () => {
    const call = reply()
    const r = await runAiFallback(makeAdmin(), ctx, { settings: ALL_OFF, callModel: call })
    expect(r).toEqual({ handled: false })
    expect(call).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
    expect(countCalls).toBe(0)
  })
  it('마스터가 꺼져 있으면 AI 스위치가 켜져 있어도 호출하지 않는다', async () => {
    const call = reply()
    await runAiFallback(makeAdmin(), ctx, { settings: { ...settings({ enabled: true }), agentEnabled: false }, callModel: call })
    expect(call).not.toHaveBeenCalled()
  })
  it('관찰 모드: 호출·검증·기록만 하고 고객에게는 보내지 않는다', async () => {
    const call = reply()
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ observe: true }), callModel: call })
    expect(r).toEqual({ handled: false })
    expect(call).toHaveBeenCalledTimes(1)
    expect(msgRows()).toHaveLength(0)
    expect(obsRows()).toHaveLength(1)
    expect(obsRows()[0]).toMatchObject({ mode: 'observe', outcome: 'answered', sent: false, source_count: 1, category: 'delivery', input_tokens: 500, message_id: 'm1' })
    expect(writes.every((w) => w.table === 'ai_reply_observations')).toBe(true)
    expect(obsRows()[0].id).toBeTruthy()
  })
  it('켜짐 모드: 허용된 분류의 검증 통과 답변만 고객 세션에 보낸다', async () => {
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: reply() })
    expect(r.handled).toBe(true)
    expect(msgRows()).toHaveLength(1)
    expect(msgRows()[0].row).toMatchObject({ session_id: 's1', sender_type: 'ai', content: '편도 3,000원이에요.' })
    expect(obsRows()[0]).toMatchObject({ mode: 'on', sent: true })
  })
  it('켜짐 모드여도 허용 분류가 아니면 보내지 않고 기록만 한다', async () => {
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['hours'] }), callModel: reply() })
    expect(r).toEqual({ handled: false })
    expect(msgRows()).toHaveLength(0)
    expect(obsRows()[0]).toMatchObject({ sent: false, reason: 'category_not_allowed' })
  })
  it('근거 밖 숫자를 말하면 보내지 않고 invalid로 기록', async () => {
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: reply({ answer: '편도 9,000원이에요.' }) })
    expect(r).toEqual({ handled: false })
    expect(msgRows()).toHaveLength(0)
    expect(obsRows()[0]).toMatchObject({ outcome: 'invalid', reason: 'ungrounded_number', sent: false, draft_text: null })
  })
  it('모델이 근거 없음(decline)으로 답하면 declined', async () => {
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: reply({ decline: true, answer: '', sources: [], confidence: 0 }) })
    expect(obsRows()[0]).toMatchObject({ outcome: 'declined', sent: false })
  })
  it('형식이 깨진 출력은 invalid(format)', async () => {
    const call: ModelCaller = vi.fn().mockResolvedValue({ text: '죄송합니다', inputTokens: 1, outputTokens: 1 })
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(r.handled).toBe(false)
    expect(obsRows()[0]).toMatchObject({ outcome: 'invalid', reason: 'format' })
  })
  it('호출이 실패하면 재시도 없이(1회만) error로 기록하고 기존 흐름으로 넘긴다', async () => {
    const call: ModelCaller = vi.fn().mockRejectedValue(new Error('timeout'))
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(r).toEqual({ handled: false })
    expect(call).toHaveBeenCalledTimes(1)
    expect(obsRows()[0]).toMatchObject({ outcome: 'error', reason: 'call_failed', sent: false })
  })
  it('사람 전용 주제·조회·접수 질문은 호출하지 않는다', async () => {
    const call = reply()
    for (const content of ['렌즈가 파손됐어요 어떡하죠', '환불 받고 싶어요', '내 예약 상태 알려줘', '대여 연장하고 싶어요']) {
      await runAiFallback(makeAdmin(), { ...ctx, content }, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    }
    expect(call).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
  it('관리자가 이미 응대 중인 세션은 호출하지 않는다', async () => {
    const call = reply()
    await runAiFallback(makeAdmin(), { ...ctx, adminEngaged: true }, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(call).not.toHaveBeenCalled()
  })
  it('분당 10회·일 200회·세션 상한에 걸리면 호출하지 않는다', async () => {
    const call = reply()
    for (const counts of [{ minute: 10 }, { day: 200 }, { session: 3 }]) {
      cfg = { canned: CANNED, counts }
      await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    }
    expect(call).not.toHaveBeenCalled()
    expect(obsRows()).toHaveLength(0) // 자리를 잡았다가 반납
    expect(deletedObs).toBe(3)
  })
  it('최근 5회 연속 오류면 자동 정지(호출 안 함)', async () => {
    const now = new Date('2026-10-07T03:00:00Z')
    cfg = { canned: CANNED, recent: Array.from({ length: 5 }, () => ({ outcome: 'error', created_at: '2026-10-07T02:55:00Z' })) }
    const call = reply()
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call, now: () => now })
    expect(call).not.toHaveBeenCalled()
  })
  it('상한 확인이 실패하면 안전하게 호출하지 않는다', async () => {
    cfg = { canned: CANNED, failCount: true }
    const call = reply()
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(r).toEqual({ handled: false })
    expect(call).not.toHaveBeenCalled()
  })
  it('근거를 읽지 못하거나 근거가 하나도 없으면 호출하지 않는다', async () => {
    const call = reply()
    cfg = { failCanned: true }
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    cfg = { canned: [] }
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(call).not.toHaveBeenCalled()
  })
  it('검수 완료 정책 조각도 근거로 들어가며 프롬프트에 고객 원문이 아닌 번호표 근거가 실린다', async () => {
    cfg = { canned: CANNED, policy: [{ id: 'p1', title: '운영시간', content: '평일 10시부터 19시', category: 'hours' }] }
    const call = reply()
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ observe: true }), callModel: call })
    const args = (call as unknown as { mock: { calls: Array<[{ system: string; userTurn: string }]> } }).mock.calls[0][0]
    expect(args.system).toContain('[S1] 운영시간')
    expect(args.system).toContain('[S2] 배송비 안내')
    expect(args.userTurn).toContain('<customer_message>')
    expect(obsRows()[0]).toMatchObject({ source_count: 2 })
  })
  it('관찰 기록에는 고객 원문이 저장되지 않는다', async () => {
    await runAiFallback(makeAdmin(), { ...ctx, content: '배송비가 얼마인가요 제 번호는 010-1234-5678' }, { settings: settings({ observe: true }), callModel: reply() })
    expect(JSON.stringify(obsRows())).not.toMatch(/010-1234|제 번호/)
  })
  it('호출 자리를 잡지 못하면(기록 저장 실패) 호출하지 않는다 — 상한이 무력화되지 않도록', async () => {
    cfg = { canned: CANNED, insertFail: true }
    const call = reply()
    await expect(runAiFallback(makeAdmin(), ctx, { settings: settings({ observe: true }), callModel: call })).resolves.toEqual({ handled: false })
    expect(call).not.toHaveBeenCalled()
  })
  it('사람 전용 분류·분류 없는 근거는 프롬프트에 넣지 않는다', async () => {
    cfg = { canned: [...CANNED, { id: 'c2', title: '파손 보상', content: '파손 시 안내', category: 'damage' }, { id: 'c3', title: '분류없음', content: '내용', category: null }] }
    const call = reply()
    await runAiFallback(makeAdmin(), ctx, { settings: settings({ observe: true }), callModel: call })
    const sys = (call as unknown as { mock: { calls: Array<[{ system: string }]> } }).mock.calls[0][0].system
    expect(sys).toContain('배송비 안내')
    expect(sys).not.toContain('파손 보상')
    expect(sys).not.toContain('분류없음')
  })
  it('인용한 근거 중 하나라도 허용 분류가 아니면 켜짐 모드에서 보내지 않는다', async () => {
    cfg = { canned: [...CANNED, { id: 'c4', title: '운영 안내', content: '평일 10시부터 19시', category: 'hours' }] }
    const call: ModelCaller = vi.fn().mockResolvedValue({
      text: JSON.stringify({ decline: false, answer: '편도 3,000원이에요. 평일 10시부터 19시예요.', sources: ['S1', 'S2'], confidence: 0.9 }), inputTokens: 1, outputTokens: 1,
    })
    const r = await runAiFallback(makeAdmin(), ctx, { settings: settings({ enabled: true, cats: ['delivery'] }), callModel: call })
    expect(r).toEqual({ handled: false })
    expect(obsRows()[0]).toMatchObject({ sent: false, reason: 'category_not_allowed' })
  })
})
