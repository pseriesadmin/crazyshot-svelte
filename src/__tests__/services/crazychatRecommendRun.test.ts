import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCrazychatRecommend, RECOMMEND_MIN_SCORE } from '$lib/server/crazychat/recommend-runner'
import { runCrazychatAgent } from '$lib/server/crazychat/agent'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

/** 크레이지챗 추천형 실행기 — 꺼짐/관찰/켜짐 모드, 되묻기, 결과 없음, 쓰기 경계 */
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined), sendUrgentChatAdminPush: vi.fn(), sendCrazychatRequestAdminPush: vi.fn() }))

let writes: Array<{ table: string; row: Record<string, unknown> }>
let msgId: number
let deleted: string[]
let failCards: boolean
function makeAdmin() {
  return {
    from(table: string) {
      const qb: Record<string, unknown> = {}
      qb.insert = (row: Record<string, unknown>) => {
        writes.push({ table, row })
        if (table === 'chat_messages') {
          const isCard = row.message_type === 'action_card'
          return { select: () => ({ single: async () => (isCard && failCards ? { data: null, error: { message: 'x' } } : { data: { id: `m${++msgId}`, sender_type: 'ai', ...row }, error: null }) }) }
        }
        return Promise.resolve({ error: null })
      }
      qb.update = (row: Record<string, unknown>) => { writes.push({ table, row }); return { eq: async () => ({ error: null }) } }
      qb.delete = () => ({ eq: async (_c: string, v: unknown) => { deleted.push(String(v)); return { error: null } } })
      qb.select = () => qb
      qb.limit = () => qb
      qb.maybeSingle = async () => ({ data: null, error: null })
      return qb
    },
  }
}
const settings = (mode: 'off' | 'observe' | 'on', master = true): CrazychatSettings => ({ ...ALL_OFF, agentEnabled: master, recommend: { enabled: mode === 'on', observe: mode === 'observe' } })
const ctx = (content: string) => ({ userId: 'u1', sessionId: 's1', messageId: 'um1', content, adminEngaged: false })
const found = (ids: string[]) => vi.fn().mockResolvedValue({
  hits: ids.map((id, i) => ({ id, score: 30 - i })),
  rows: ids.map((id) => ({ id, name: `상품 ${id}`, slug: `s-${id}`, image_urls: [`i-${id}`], sale_only: false, option_only: false, is_active: true, deleted_at: null })),
  prices: Object.fromEntries(ids.map((id, i) => [id, 10000 * (i + 1)])),
})
const obs = () => writes.filter((w) => w.table === 'crazychat_query_observations').map((w) => w.row)
const msgs = () => writes.filter((w) => w.table === 'chat_messages').map((w) => w.row)

beforeEach(() => { writes = []; msgId = 0; deleted = []; failCards = false })

describe('runCrazychatRecommend', () => {
  it('꺼짐·마스터 꺼짐이면 검색도 쓰기도 하지 않는다', async () => {
    const s = found(['a'])
    for (const st of [settings('off'), settings('on', false), ALL_OFF]) {
      expect(await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: st, searchProducts: s })).toEqual({ handled: false })
    }
    expect(s).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
  it('추천 질문이 아니면 검색하지 않는다', async () => {
    const s = found(['a'])
    for (const m of ['내 예약 상태 알려줘', '연장하고 싶어요', '배송비 얼마예요', '렌즈 파손 추천']) {
      await runCrazychatRecommend(makeAdmin(), ctx(m), { settings: settings('on'), searchProducts: s })
    }
    expect(s).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
  it('관리자가 응대 중이면 끼어들지 않는다', async () => {
    const s = found(['a'])
    await runCrazychatRecommend(makeAdmin(), { ...ctx('카메라 추천해 주세요'), adminEngaged: true }, { settings: settings('on'), searchProducts: s })
    expect(s).not.toHaveBeenCalled()
  })
  it('관찰 모드: 검색·기록만 하고 고객에게는 보내지 않는다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('observe'), searchProducts: found(['a', 'b']) })
    expect(r).toEqual({ handled: false })
    expect(msgs()).toHaveLength(0)
    expect(obs()).toMatchObject([{ message_id: 'um1', mode: 'observe', intent: 'recommend', outcome: 'answered', group_count: 2 }])
  })
  it('켜짐 모드: 안내 문구 1개 + 상품 카드 최대 3장을 보낸다', async () => {
    const s = found(['a', 'b', 'c', 'd'])
    const r = await runCrazychatRecommend(makeAdmin(), ctx('브이로그용 카메라 추천해 주세요'), { settings: settings('on'), searchProducts: s })
    expect(r.handled).toBe(true)
    const m = msgs()
    expect(m).toHaveLength(4)
    expect(m[0]).toMatchObject({ sender_type: 'ai', message_type: 'text', action_payload: { type: 'crazychat_reply', source: 'recommend' } })
    expect(m.slice(1).map((x) => x.message_type)).toEqual(['action_card', 'action_card', 'action_card'])
    expect(m[1].action_payload).toEqual({ type: 'PRODUCT_CARD', is_expired: false, product_id: 'a', product_name: '상품 a', product_price: 10000, product_image: 'i-a', action_url: '/products/s-a' })
    expect(obs()).toMatchObject([{ message_id: 'um1', mode: 'on', intent: 'recommend', outcome: 'answered', group_count: 3 }])
    // 검색어는 요청 표현을 뺀 핵심 단어
    expect(s.mock.calls[0][1]).toContain('카메라')
  })
  it('쓰기 경계: 채팅 메시지·세션 갱신·관찰 기록 외에는 쓰지 않는다', async () => {
    await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: found(['a']) })
    expect([...new Set(writes.map((w) => w.table))].sort()).toEqual(['chat_messages', 'chat_sessions', 'crazychat_query_observations'])
  })
  it('종류·용도를 말하지 않으면 카드 없이 되묻고(켜짐) 검색하지 않는다', async () => {
    const s = found(['a'])
    const r = await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해주세요'), { settings: settings('on'), searchProducts: s })
    expect(r.handled).toBe(true)
    expect(s).not.toHaveBeenCalled()
    expect(msgs()).toHaveLength(1)
    expect(msgs()[0].content).toContain('알려 주시면')
    expect(obs()[0]).toMatchObject({ outcome: 'no_data', group_count: 0 })
  })
  it('관찰 모드의 되묻기는 보내지 않는다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해주세요'), { settings: settings('observe'), searchProducts: found(['a']) })
    expect(r).toEqual({ handled: false })
    expect(msgs()).toHaveLength(0)
  })
  it('검색 결과가 없으면 아무것도 보내지 않고 기존 흐름으로 넘긴다', async () => {
    const empty = vi.fn().mockResolvedValue({ hits: [], rows: [], prices: {} })
    const r = await runCrazychatRecommend(makeAdmin(), ctx('우주선 추천해 주세요'), { settings: settings('on'), searchProducts: empty })
    expect(r).toEqual({ handled: false })
    expect(msgs()).toHaveLength(0)
    expect(obs()[0]).toMatchObject({ outcome: 'no_data' })
  })
  it('점수가 하한 미만이면 카드로 보내지 않는다', async () => {
    const weak = vi.fn().mockResolvedValue({ hits: [{ id: 'a', score: RECOMMEND_MIN_SCORE - 0.1 }], rows: [{ id: 'a', name: 'x', slug: 'x', image_urls: [], sale_only: false }], prices: { a: 100 } })
    const r = await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: weak })
    expect(r).toEqual({ handled: false })
  })
  it('카드가 한 장도 저장되지 않으면 안내 문구를 지우고 기존 흐름으로 넘긴다(거짓 안내 방지)', async () => {
    failCards = true
    const r = await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: found(['a', 'b']) })
    expect(r).toEqual({ handled: false })
    expect(deleted).toEqual(['m1'])
    expect(obs()[0]).toMatchObject({ outcome: 'error', group_count: 0 })
  })
  it('판매전용만 걸리는 검색은 카드 없음(대여 상품만)', async () => {
    const s = vi.fn().mockResolvedValue({ hits: [{ id: 'a', score: 30 }], rows: [{ id: 'a', name: 'x', slug: 'x', image_urls: [], sale_only: true }], prices: { a: 100 } })
    expect(await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: s })).toEqual({ handled: false })
  })
  it('검색기가 실패해도 던지지 않고 기록 후 기존 흐름', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('db'))
    const r = await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: boom })
    expect(r).toEqual({ handled: false })
    expect(obs()[0]).toMatchObject({ outcome: 'error' })
  })
})

describe('에이전트 연결 순서', () => {
  it('조회/접수가 처리하지 않은 추천 질문은 추천형이 받고, 예약 질문은 추천형에 가지 않는다', async () => {
    const s = found(['a'])
    const r = await runCrazychatAgent(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: s })
    expect(r.handled).toBe(true)
    expect(s).toHaveBeenCalledTimes(1)
  })
})

/** 재보정용 관찰 메트릭(Migration 672) — 숫자·상품 id만 남고, 하한 미달 후보도 기록된다 */
describe('runCrazychatRecommend — 관찰 메트릭', () => {
  const lowFound = (ids: string[]) => vi.fn().mockResolvedValue({
    hits: ids.map((id, i) => ({ id, score: 2 - i * 0.5 })),
    rows: ids.map((id) => ({ id, name: `상품 ${id}`, slug: `s-${id}`, image_urls: [`i-${id}`], sale_only: false, option_only: false, is_active: true, deleted_at: null })),
    prices: Object.fromEntries(ids.map((id) => [id, 10000])),
  })

  it('켜짐 모드 답변: 상위 3개 점수·상품 id·사용한 하한·확장 여부(기본 false)를 함께 기록한다', async () => {
    await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: found(['a', 'b', 'c', 'd']) })
    expect(obs()).toEqual([{
      message_id: 'um1', mode: 'on', intent: 'recommend', outcome: 'answered', group_count: 3,
      top_score: 30, card_scores: [30, 29, 28], product_ids: ['a', 'b', 'c'], min_score_used: RECOMMEND_MIN_SCORE, expanded: false,
    }])
  })

  it('점수 하한 미달로 카드가 나가지 않아도(no_data) 탈락한 후보의 점수·상품 id를 기록한다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: lowFound(['a', 'b']) })
    expect(r).toEqual({ handled: false })
    expect(msgs()).toHaveLength(0)
    expect(obs()).toEqual([{
      message_id: 'um1', mode: 'on', intent: 'recommend', outcome: 'no_data', group_count: 0,
      top_score: 2, card_scores: [2, 1.5], product_ids: ['a', 'b'], min_score_used: RECOMMEND_MIN_SCORE, expanded: false,
    }])
  })

  it('관찰 모드: 고객에게는 보내지 않고 메트릭만 남긴다', async () => {
    await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('observe'), searchProducts: found(['a', 'b']) })
    expect(msgs()).toHaveLength(0)
    expect(obs()).toMatchObject([{ mode: 'observe', outcome: 'answered', group_count: 2, top_score: 30, product_ids: ['a', 'b'] }])
  })

  it('동의어 변형이 사용됐으면 expanded=true로 기록한다', async () => {
    const s = vi.fn().mockResolvedValue({ ...(await found(['a'])()), usedExpansion: true })
    await runCrazychatRecommend(makeAdmin(), ctx('소니 카메라 추천해 주세요'), { settings: settings('observe'), searchProducts: s })
    expect(obs()).toMatchObject([{ expanded: true }])
  })

  it('검색 결과가 0건이면 점수·상품 id는 null로 기록한다', async () => {
    const s = vi.fn().mockResolvedValue({ hits: [], rows: [], prices: {} })
    await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: s })
    expect(obs()).toMatchObject([{ outcome: 'no_data', top_score: null, card_scores: null, product_ids: null, min_score_used: RECOMMEND_MIN_SCORE, expanded: false }])
  })

  it('되묻기(검색어 없음)는 검색이 일어나지 않으므로 메트릭 없이 기록한다', async () => {
    const s = found(['a'])
    await runCrazychatRecommend(makeAdmin(), ctx('추천해 주세요'), { settings: settings('on'), searchProducts: s })
    expect(s).not.toHaveBeenCalled()
    expect(obs()).toHaveLength(1)
    expect(Object.keys(obs()[0])).not.toContain('top_score')
  })

  it('기록에는 고객 문장·검색어 원문이 들어가지 않는다', async () => {
    await runCrazychatRecommend(makeAdmin(), ctx('브이로그용 카메라 추천해 주세요'), { settings: settings('on'), searchProducts: found(['a']) })
    const serialized = JSON.stringify(obs())
    expect(serialized.includes('브이로그')).toBe(false)
    expect(serialized.includes('카메라')).toBe(false)
  })
})
