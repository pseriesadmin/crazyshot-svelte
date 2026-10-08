/**
 * TDD: 크레이지챗 추천 — 막연한 추천 요청에 "인기 상품 카드" (2026-10-08)
 * "아무거나 추천해 주세요"처럼 용도·종류가 없으면 지금까지는 되묻기만 했다.
 * 이제 지식 저장소의 "최근 90일 인기 상품(예약 건수)" 집계로 상품 카드를 함께 보낸다.
 * 예약의 product_id는 재고 단위(자식)라서, 집계 전에 부모 상품 id로 합쳐야 카드가 된다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveParentIds, buildReservationDigest } from '$lib/server/crazychat/knowledge/digest'
import { selectPopularHits, POPULAR_MIN_COUNT } from '$lib/server/crazychat/popular'
import { runCrazychatRecommend } from '$lib/server/crazychat/recommend-runner'
import { RECOMMEND_REPLY } from '$lib/server/crazychat/recommend'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined), sendUrgentChatAdminPush: vi.fn(), sendCrazychatRequestAdminPush: vi.fn() }))

describe('resolveParentIds', () => {
  const rowOf = (product_id: string) => ({ status: 'confirmed', pickup_method: 'visit', return_method: 'visit', duration_type: '24h', start_date: '2026-10-01', end_date: '2026-10-02', created_at: '2026-10-01T00:00:00Z', product_id })
  it('자식 재고 id를 부모 상품 id로 바꾼다(부모 자신이면 그대로, 모르는 id는 그대로)', () => {
    const map = new Map<string, string | null>([['c1', 'p1'], ['c2', 'p1'], ['p2', null]])
    const out = resolveParentIds([rowOf('c1'), rowOf('c2'), rowOf('p2'), rowOf('x9')], map)
    expect(out.map((r) => r.product_id)).toEqual(['p1', 'p1', 'p2', 'x9'])
  })
  it('부모로 합친 뒤 집계하면 같은 상품의 재고들이 한 상품으로 센다', () => {
    const map = new Map<string, string | null>([['c1', 'p1'], ['c2', 'p1']])
    const d = buildReservationDigest(resolveParentIds([rowOf('c1'), rowOf('c2')], map), new Date('2026-10-08T00:00:00Z'))
    expect(d.popularProducts).toEqual([{ productId: 'p1', count: 2 }])
  })
})

describe('selectPopularHits', () => {
  it('최소 건수 이상인 상품만, 건수순으로 점수화한다', () => {
    const hits = selectPopularHits({ popularProducts: [{ productId: 'a', count: 5 }, { productId: 'b', count: POPULAR_MIN_COUNT }, { productId: 'c', count: POPULAR_MIN_COUNT - 1 }] })
    expect(hits).toEqual([{ id: 'a', score: 5 }, { id: 'b', score: POPULAR_MIN_COUNT }])
  })
  it('요약이 없거나 형식이 이상하면 빈 목록', () => {
    expect(selectPopularHits(null)).toEqual([])
    expect(selectPopularHits({})).toEqual([])
    expect(selectPopularHits({ popularProducts: 'x' as never })).toEqual([])
  })
})

let writes: Array<{ table: string; row: Record<string, unknown> }>
let msgId: number
function makeAdmin() {
  return {
    from(table: string) {
      const qb: Record<string, unknown> = {}
      qb.insert = (row: Record<string, unknown>) => {
        writes.push({ table, row })
        if (table === 'chat_messages') return { select: () => ({ single: async () => ({ data: { id: `m${++msgId}`, sender_type: 'ai', ...row }, error: null }) }) }
        return Promise.resolve({ error: null })
      }
      qb.update = (row: Record<string, unknown>) => { writes.push({ table, row }); return { eq: async () => ({ error: null }) } }
      qb.delete = () => ({ eq: async () => ({ error: null }) })
      qb.select = () => qb
      qb.limit = () => qb
      qb.maybeSingle = async () => ({ data: null, error: null })
      return qb
    },
  }
}
const settings = (mode: 'observe' | 'on'): CrazychatSettings => ({ ...ALL_OFF, agentEnabled: true, recommend: { enabled: mode === 'on', observe: mode === 'observe' } })
const ctx = (content: string) => ({ userId: 'u1', sessionId: 's1', messageId: 'um1', content, adminEngaged: false })
const popular = (ids: string[]) => vi.fn().mockResolvedValue({
  hits: ids.map((id, i) => ({ id, score: 10 - i })),
  rows: ids.map((id) => ({ id, name: `상품 ${id}`, slug: `s-${id}`, image_urls: [`i-${id}`], sale_only: false, option_only: false, is_active: true, deleted_at: null })),
  prices: Object.fromEntries(ids.map((id) => [id, 20000])),
})
const sentTexts = () => writes.filter((w) => w.table === 'chat_messages' && w.row.message_type !== 'action_card').map((w) => w.row.content)
const cards = () => writes.filter((w) => w.table === 'chat_messages' && w.row.message_type === 'action_card')
const searchNever = vi.fn()

beforeEach(() => { writes = []; msgId = 0; searchNever.mockClear() })

describe('runCrazychatRecommend — 막연한 추천 요청 + 인기 상품', () => {
  it('인기 상품이 있으면 인기 안내 문구 + 카드(최대 3장)를 보낸다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해 주세요'), { settings: settings('on'), searchProducts: searchNever, loadPopular: popular(['a', 'b', 'c', 'd']) })
    expect(r.handled).toBe(true)
    expect(sentTexts()).toEqual([RECOMMEND_REPLY.popularIntro])
    expect(cards()).toHaveLength(3)
    expect(searchNever).not.toHaveBeenCalled()
  })
  it('인기 상품이 없으면(집계 전·건수 부족) 기존처럼 되묻기만 한다', async () => {
    const none = vi.fn().mockResolvedValue({ hits: [], rows: [], prices: {} })
    await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해 주세요'), { settings: settings('on'), searchProducts: searchNever, loadPopular: none })
    expect(sentTexts()).toEqual([RECOMMEND_REPLY.needDetail])
    expect(cards()).toHaveLength(0)
  })
  it('인기 조회가 실패해도 되묻기로 이어간다(던지지 않음)', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('x'))
    const r = await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해 주세요'), { settings: settings('on'), searchProducts: searchNever, loadPopular: boom })
    expect(r.handled).toBe(true)
    expect(sentTexts()).toEqual([RECOMMEND_REPLY.needDetail])
  })
  it('관찰 모드: 기록만 하고 보내지 않는다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('아무거나 추천해 주세요'), { settings: settings('observe'), searchProducts: searchNever, loadPopular: popular(['a']) })
    expect(r).toEqual({ handled: false })
    expect(writes.filter((w) => w.table === 'chat_messages')).toHaveLength(0)
    expect(writes.some((w) => w.table === 'crazychat_query_observations')).toBe(true)
  })
  it('용도·종류를 말한 추천 요청은 인기 상품이 아니라 검색 결과를 쓴다', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [{ id: 's1', score: 30 }], rows: [{ id: 's1', name: '검색 상품', slug: 's-s1', image_urls: [], sale_only: false, option_only: false, is_active: true, deleted_at: null }], prices: { s1: 30000 } })
    const lp = popular(['a'])
    await runCrazychatRecommend(makeAdmin(), ctx('카메라 추천해 주세요'), { settings: settings('on'), searchProducts: search, loadPopular: lp })
    expect(lp).not.toHaveBeenCalled()
    expect(cards()).toHaveLength(1)
  })
})
