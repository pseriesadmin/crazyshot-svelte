/**
 * TDD: 크레이지챗 지식 저장소 — 매일 새벽 정리 작업 (2026-10-08)
 * 4개 재료(빠른답변 · 상품 색인 · 상품 후기 · 고객 예약)를 AI가 읽기 좋은 요약으로 만들어 저장한다.
 * 개인정보 원칙: 요약본에는 고객 식별 정보·후기 원문을 넣지 않는다(집계·단어 빈도만).
 */
import { describe, it, expect } from 'vitest'
import { buildFaqDigest, buildProductDigest, buildReviewDigest, buildReservationDigest, digestHash } from '$lib/server/crazychat/knowledge/digest'
import { runKnowledgeBuild, type KnowledgeStore, type KnowledgeSource } from '$lib/server/crazychat/knowledge/build'
import { summarizeKnowledgeForAgent } from '$lib/server/crazychat/knowledge/read'

describe('buildFaqDigest', () => {
  const rows = [
    { id: 'aaaa1111-0000', title: '보증금은 얼마인가요?', category: 'payment', shortcut: '보증금', match_keywords: ['보증금', '예치금', '보증금얼마'], usage_count: 5 },
    { id: 'bbbb2222-0000', title: '배송 업체 안내', category: 'reservation', shortcut: null, match_keywords: [], usage_count: 1 },
    { id: 'cccc3333-0000', title: '반납 안내', category: 'return', shortcut: null, match_keywords: ['반납'], usage_count: 9 },
  ]
  it('건수·분류별·키워드 없는 FAQ·키워드 부족 FAQ·자주 쓰인 FAQ를 요약한다', () => {
    const d = buildFaqDigest(rows)
    expect(d.count).toBe(3)
    expect(d.byCategory).toEqual({ payment: 1, reservation: 1, return: 1 })
    expect(d.noKeyword).toEqual(['bbbb2222'])
    expect(d.thinKeyword).toContain('cccc3333')
    expect(d.topUsed[0]).toEqual({ id: 'cccc3333', title: '반납 안내', usage: 9 })
    expect(d.faqs.find((f) => f.id === 'aaaa1111')?.keywordCount).toBe(3)
  })
})

describe('buildProductDigest', () => {
  const rows = [
    { id: 'p1', name: '소니 FX3', brand: '소니', category: 'camera', keywords: ['시네마'], product_caption: '풀프레임', specifications: [{ key: '화소', value: '12MP' }], components: {}, sale_only: false },
    { id: 'p2', name: '캐논 R5', brand: '캐논', category: 'camera', keywords: [], product_caption: '', specifications: {}, components: [], sale_only: false },
    { id: 'p3', name: '삼각대', brand: '', category: 'accessorie', keywords: ['삼각대'], product_caption: '튼튼', specifications: {}, components: {}, sale_only: true },
  ]
  it('상품 수·분류별·브랜드별·빈약 정보 건수를 요약한다', () => {
    const d = buildProductDigest(rows)
    expect(d.count).toBe(3)
    expect(d.byCategory).toEqual({ camera: 2, accessorie: 1 })
    expect(d.brands[0]).toEqual({ brand: '소니', count: 1 })
    expect(d.saleOnly).toBe(1)
    expect(d.noKeywords).toBe(1)
    expect(d.noSpecs).toBe(2)
    expect(d.thinProducts).toEqual([{ id: 'p2', name: '캐논 R5' }])
  })
})

describe('buildReviewDigest', () => {
  it('후기 원문은 담지 않고 건수·상품별 건수·자주 나온 단어만 담는다', () => {
    const d = buildReviewDigest([
      { product_id: 'p1', title: '화질 좋아요', content: '화질이 정말 좋고 배터리 오래가요 연락처 010-1234-5678' },
      { product_id: 'p1', title: '배터리 만족', content: '배터리 오래가서 만족' },
      { product_id: 'p2', title: '무겁다', content: '조금 무겁지만 화질 좋음' },
    ])
    expect(d.count).toBe(3)
    expect(d.productsWithReviews).toBe(2)
    expect(d.perProduct[0]).toEqual({ productId: 'p1', count: 2 })
    expect(d.topTerms.find((t) => t.term === '배터리')?.count).toBeGreaterThanOrEqual(2)
    const serialized = JSON.stringify(d)
    expect(serialized).not.toContain('010-1234-5678')
    expect(serialized).not.toContain('화질이 정말 좋고')
  })
  it('후기가 없으면 0건 요약', () => {
    expect(buildReviewDigest([])).toMatchObject({ count: 0, productsWithReviews: 0, perProduct: [], topTerms: [] })
  })
})

describe('buildReservationDigest', () => {
  const now = new Date('2026-10-08T00:00:00Z')
  const rows = [
    { status: 'confirmed', pickup_method: 'visit', return_method: 'visit', duration_type: '24h', start_date: '2026-10-01', end_date: '2026-10-03', created_at: '2026-10-01T00:00:00Z' },
    { status: 'cancelled', pickup_method: 'parcel', return_method: 'parcel', duration_type: '24h', start_date: '2026-09-01', end_date: '2026-09-02', created_at: '2026-09-01T00:00:00Z' },
    { status: 'returned', pickup_method: 'visit', return_method: 'parcel', duration_type: '12h', start_date: '2026-08-10', end_date: '2026-08-10', created_at: '2026-08-10T00:00:00Z' },
  ]
  it('상태·수령·반납·기간유형·월별 건수와 평균 대여일을 집계한다(개인 식별 정보 없음)', () => {
    const d = buildReservationDigest(rows, now)
    expect(d.count).toBe(3)
    expect(d.byStatus).toEqual({ confirmed: 1, cancelled: 1, returned: 1 })
    expect(d.byPickup).toEqual({ visit: 2, parcel: 1 })
    expect(d.byReturn).toEqual({ visit: 1, parcel: 2 })
    expect(d.byDuration).toEqual({ '24h': 2, '12h': 1 })
    expect(d.monthly['2026-10']).toBe(1)
    expect(d.last30d).toBe(1)
    expect(d.avgRentalDays).toBeGreaterThan(0)
    expect(Object.keys(d)).not.toContain('user_id')
  })
  it('최근 90일 인기 상품(상품별 예약 건수, 취소 제외)을 집계한다', () => {
    const withProduct = [
      { ...rows[0], product_id: 'p1' }, { ...rows[0], product_id: 'p1' }, { ...rows[0], product_id: 'p2' },
      { ...rows[1], product_id: 'p3', created_at: '2026-10-02T00:00:00Z' }, // 취소 → 제외
      { ...rows[2], product_id: 'p9', created_at: '2026-01-01T00:00:00Z' }, // 90일 밖 → 제외
    ]
    const d = buildReservationDigest(withProduct, now)
    expect(d.popularProducts).toEqual([{ productId: 'p1', count: 2 }, { productId: 'p2', count: 1 }])
  })
})

describe('digestHash', () => {
  it('키 순서가 달라도 같은 내용이면 같은 지문', () => {
    expect(digestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(digestHash({ b: { d: 3, c: 2 }, a: 1 }))
    expect(digestHash({ a: 1 })).not.toBe(digestHash({ a: 2 }))
  })
})

function fakeStore() {
  const rows = new Map<string, { hash: string; digest: unknown; itemCount: number }>()
  const runs: unknown[] = []
  const upserts: string[] = []
  const store: KnowledgeStore = {
    async getHash(key) { return rows.get(key)?.hash ?? null },
    async upsert(key, v) { rows.set(key, { hash: v.hash, digest: v.digest, itemCount: v.itemCount }); upserts.push(key) },
    async recordRun(r) { runs.push(r) },
  }
  return { store, rows, runs, upserts }
}
const okLoaders = {
  faq: async () => [{ id: 'aaaa1111-0', title: '보증금', category: 'payment', shortcut: null, match_keywords: ['보증금'], usage_count: 1 }],
  product: async () => [],
  review: async () => [],
  reservation: async () => [],
}

describe('runKnowledgeBuild', () => {
  it('4개 재료를 모두 만들어 저장하고 실행 기록을 남긴다', async () => {
    const f = fakeStore()
    const r = await runKnowledgeBuild({ loaders: okLoaders, store: f.store, now: () => new Date('2026-10-08T18:00:00Z') })
    expect(f.rows.size).toBe(4)
    expect(r.sources.map((s) => s.source).sort()).toEqual(['faq', 'product', 'reservation', 'review'])
    expect(r.sources.every((s) => s.status === 'updated')).toBe(true)
    expect(f.runs.length).toBe(1)
  })
  it('내용이 같으면 두 번째 실행은 unchanged로 표시한다', async () => {
    const f = fakeStore()
    await runKnowledgeBuild({ loaders: okLoaders, store: f.store, now: () => new Date() })
    const r2 = await runKnowledgeBuild({ loaders: okLoaders, store: f.store, now: () => new Date() })
    expect(r2.sources.every((s) => s.status === 'unchanged')).toBe(true)
  })
  it('한 재료가 실패해도 나머지는 계속 만든다(실패 재료는 이전 저장분 유지)', async () => {
    const f = fakeStore()
    const r = await runKnowledgeBuild({ loaders: { ...okLoaders, review: async () => { throw new Error('boom') } }, store: f.store, now: () => new Date() })
    const review = r.sources.find((s) => s.source === ('review' as KnowledgeSource))!
    expect(review.status).toBe('error')
    expect(f.rows.has('review')).toBe(false)
    expect(f.rows.has('faq')).toBe(true)
    expect(r.ok).toBe(false)
  })
})

describe('summarizeKnowledgeForAgent', () => {
  it('저장소 요약을 에이전트가 읽기 쉬운 짧은 문장 목록으로 만든다', () => {
    const faq = buildFaqDigest([{ id: 'aaaa1111-0', title: '보증금은?', category: 'payment', shortcut: null, match_keywords: ['보증금'], usage_count: 3 }])
    const text = summarizeKnowledgeForAgent({ faq, product: null, review: null, reservation: null })
    expect(text).toContain('빠른답변 1건')
    expect(text.length).toBeLessThan(2000)
    expect(summarizeKnowledgeForAgent({ faq: null, product: null, review: null, reservation: null })).toBe('')
  })
})
