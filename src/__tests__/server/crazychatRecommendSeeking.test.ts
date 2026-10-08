/**
 * TDD: 크레이지챗 추천 — "상품을 찾는 질문"도 검색 색인으로 상품을 제안한다 (2026-10-08)
 * 기존: "추천해 주세요" 같은 표현이 있어야만 상품 카드를 보냈다.
 * 추가: "소니 A7M4 있어요?", "FX3 대여료 얼마예요", "삼각대 빌릴 수 있나요"처럼 상품을 찾는 질문도 색인 검색 결과가 확실할 때 카드를 보낸다.
 * 안전: 정책·절차 질문(배송비·보증금·반납 등), 사람 전용 주제, 예약 조회/접수 질문은 대상이 아니다. 확실도 하한은 추천 요청보다 높다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractSeekingQuery, isProductSeekingQuestion } from '$lib/server/crazychat/recommend'
import { runCrazychatRecommend, RECOMMEND_MIN_SCORE, RECOMMEND_SEEKING_MIN_SCORE } from '$lib/server/crazychat/recommend-runner'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined), sendUrgentChatAdminPush: vi.fn(), sendCrazychatRequestAdminPush: vi.fn() }))

describe('isProductSeekingQuestion', () => {
  it('상품을 찾는 질문이면 true', () => {
    for (const m of ['소니 A7M4 있어요?', '캐논 R5 빌릴 수 있나요', 'FX3 대여료 얼마예요', '고프로 재고 있나요', '삼각대 대여 가능한가요', '짐벌 있나요', 'DJI 드론 빌리고 싶어요']) {
      expect(isProductSeekingQuestion(m), m).toBe(true)
    }
  })
  it('정책·절차 질문은 false', () => {
    for (const m of ['배송비 얼마예요', '보증금 있나요', '반납 장소 어디예요', '쿠폰 있나요', '연장 가능한가요', '영업시간 몇시까지 해요', '결제 가능한가요', '예약 가능한가요', '포인트 얼마나 쌓여요']) {
      expect(isProductSeekingQuestion(m), m).toBe(false)
    }
  })
  it('사람 전용 주제·예약 조회/접수·인사·추천 요청(기존 경로)은 false', () => {
    for (const m of ['렌즈 파손됐는데 있나요', '내 예약 상태 알려줘', '반납 연장하고 싶어요', '안녕하세요', '카메라 추천해 주세요', '']) {
      expect(isProductSeekingQuestion(m), m).toBe(false)
    }
    expect(isProductSeekingQuestion(undefined)).toBe(false)
  })
})

describe('extractSeekingQuery', () => {
  it('찾는 말투(있어요·빌릴·대여료·얼마예요 등)를 빼고 상품 단어만 검색어로 남긴다', () => {
    expect(extractSeekingQuery('소니 카메라 있어요?').query).toBe('소니 카메라')
    expect(extractSeekingQuery('DJI 드론 빌리고 싶어요').query).toBe('dji 드론')
    expect(extractSeekingQuery('삼각대 대여 가능한가요').query).toBe('삼각대')
    expect(extractSeekingQuery('FX3 대여료 얼마예요').query).toBe('fx3')
    expect(extractSeekingQuery('캐논 R5 빌릴 수 있나요').tokens).toEqual(['캐논', 'r5'])
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
const on: CrazychatSettings = { ...ALL_OFF, agentEnabled: true, recommend: { enabled: true, observe: false } }
const ctx = (content: string) => ({ userId: 'u1', sessionId: 's1', messageId: 'um1', content, adminEngaged: false })
const found = (score: number) => vi.fn().mockResolvedValue({
  hits: [{ id: 'a', score }],
  rows: [{ id: 'a', name: '소니 A7M4', slug: 's-a', image_urls: ['i-a'], sale_only: false, option_only: false, is_active: true, deleted_at: null }],
  prices: { a: 50000 },
})
const cardCount = () => writes.filter((w) => w.table === 'chat_messages' && w.row.message_type === 'action_card').length

beforeEach(() => { writes = []; msgId = 0 })

describe('runCrazychatRecommend — 상품을 찾는 질문', () => {
  it('상품 찾는 질문 + 확실한 검색 결과(하한 이상)면 카드를 보낸다', async () => {
    const r = await runCrazychatRecommend(makeAdmin(), ctx('소니 A7M4 있어요?'), { settings: on, searchProducts: found(RECOMMEND_SEEKING_MIN_SCORE + 2) })
    expect(r.handled).toBe(true)
    expect(cardCount()).toBe(1)
  })
  it('확실도가 찾기 하한보다 낮으면(추천 하한 이상이어도) 보내지 않고 기존 흐름으로 넘긴다', async () => {
    const score = (RECOMMEND_MIN_SCORE + RECOMMEND_SEEKING_MIN_SCORE) / 2
    expect(score).toBeGreaterThanOrEqual(RECOMMEND_MIN_SCORE)
    expect(score).toBeLessThan(RECOMMEND_SEEKING_MIN_SCORE)
    const r = await runCrazychatRecommend(makeAdmin(), ctx('소니 A7M4 있어요?'), { settings: on, searchProducts: found(score) })
    expect(r).toEqual({ handled: false })
    expect(cardCount()).toBe(0)
  })
  it('추천 요청은 기존 하한(더 낮음)을 그대로 쓴다', async () => {
    const score = (RECOMMEND_MIN_SCORE + RECOMMEND_SEEKING_MIN_SCORE) / 2
    const r = await runCrazychatRecommend(makeAdmin(), ctx('소니 카메라 추천해 주세요'), { settings: on, searchProducts: found(score) })
    expect(r.handled).toBe(true)
  })
  it('정책·절차 질문은 검색하지 않는다', async () => {
    const s = found(99)
    for (const m of ['배송비 얼마예요', '보증금 있나요', '반납 장소 어디예요']) await runCrazychatRecommend(makeAdmin(), ctx(m), { settings: on, searchProducts: s })
    expect(s).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
  it('관찰 모드에서는 기록만 하고 고객에게 보내지 않는다', async () => {
    const obs: CrazychatSettings = { ...on, recommend: { enabled: false, observe: true } }
    const r = await runCrazychatRecommend(makeAdmin(), ctx('소니 A7M4 있어요?'), { settings: obs, searchProducts: found(30) })
    expect(r).toEqual({ handled: false })
    expect(cardCount()).toBe(0)
    expect(writes.some((w) => w.table === 'crazychat_query_observations')).toBe(true)
  })
})
