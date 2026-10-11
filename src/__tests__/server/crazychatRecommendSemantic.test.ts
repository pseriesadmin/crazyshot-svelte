/**
 * crazychatRecommendSemantic.test.ts — C-2 추천 검색 의미 후보 합류 계약
 * 꺼짐(기본)이면 기존 추천 결과와 완전히 동일 / 켜면 "새 후보만" 낮은 점수로 추가(기존 후보 순위·점수 불변) / 관찰 기록은 숫자만.
 */
import { describe, it, expect, vi } from 'vitest'
import { applySemanticCandidates, SEM_ADD_FACTOR, SEM_MAX_ADD } from '$lib/server/crazychat/recommend-semantic'
import { createRecommendSearcher } from '$lib/server/crazychat/recommend-search'

describe('applySemanticCandidates', () => {
  const sims = new Map([['s1', 0.9], ['s2', 0.8], ['s3', 0.7], ['s4', 0.6], ['old', 0.95]])

  it('apply=false면 병합 맵을 건드리지 않고 "추가됐을 후보"만 돌려준다', () => {
    const merged = new Map([['old', 10]])
    const would = applySemanticCandidates(merged, sims, false)
    expect(would).toEqual(['s1', 's2', 's3'])
    expect([...merged.entries()]).toEqual([['old', 10]])
  })

  it('apply=true면 새 후보만 최대 SEM_MAX_ADD개 낮은 점수로 추가하고 기존 후보는 그대로', () => {
    const merged = new Map([['old', 10]])
    const added = applySemanticCandidates(merged, sims, true)
    expect(added).toHaveLength(SEM_MAX_ADD)
    expect(merged.get('old')).toBe(10)
    expect(merged.get('s1')).toBeCloseTo(10 * SEM_ADD_FACTOR * 0.9, 6)
    for (const id of added) expect(merged.get(id)!).toBeLessThan(10)
  })

  it('유사도 맵이 비면 아무 일도 없다', () => {
    const merged = new Map([['old', 10]])
    expect(applySemanticCandidates(merged, new Map(), true)).toEqual([])
    expect(merged.size).toBe(1)
  })
})

// 가짜 DB·인덱스 — 검색은 항상 p1만 찾는다
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => ({
    search: () => [{ document: { id: 'p1' }, score: 10 }],
    docs: [],
  }),
}))

function fakeAdmin(): never {
  const rows = [
    { id: 'p1', name: 'A', slug: 'a', image_urls: [], sale_only: false, is_active: true, option_only: false, deleted_at: null },
    { id: 'p2', name: 'B', slug: 'b', image_urls: [], sale_only: false, is_active: true, option_only: false, deleted_at: null },
  ]
  const prices = [{ product_id: 'p1', duration_type: '24h', price: 1000 }, { product_id: 'p2', duration_type: '24h', price: 2000 }]
  const chain = (data: unknown[]) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'is', 'eq']) c[m] = () => c
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res)
    return c
  }
  return { from: (t: string) => chain(t === 'products' ? rows : prices) } as never
}

describe('createRecommendSearcher + 의미 보조', () => {
  const search = (assist: Parameters<typeof createRecommendSearcher>[1]) => createRecommendSearcher(async () => [], assist)(fakeAdmin(), '카메라', ['카메라'])

  it('assist가 없으면(꺼짐) 기존과 같은 결과', async () => {
    const r = await search(async () => null)
    expect(r.hits.map((h) => h.id)).toEqual(['p1'])
    expect(r.semanticAdded ?? 0).toBe(0)
  })

  it('recommend=true면 새 후보(p2)가 낮은 점수로 합류', async () => {
    const r = await search(async () => ({ recommend: true, shadow: false, sims: new Map([['p2', 0.8]]) }))
    expect(r.hits.map((h) => h.id)).toEqual(['p1', 'p2'])
    expect(r.hits[0].score).toBe(10)
    expect(r.semanticAdded).toBe(1)
  })

  it('recommend=false(관찰만)면 결과는 그대로이고 추가 후보 수만 알린다', async () => {
    const onShadow = vi.fn()
    const r = await search(async () => ({ recommend: false, shadow: true, sims: new Map([['p2', 0.8]]), onShadow }))
    expect(r.hits.map((h) => h.id)).toEqual(['p1'])
    expect(r.semanticAdded ?? 0).toBe(0)
    expect(onShadow).toHaveBeenCalledWith({ currentCount: 1, wouldAdd: 1 })
  })

  it('assist가 예외를 던져도 기존 결과를 돌려준다', async () => {
    const r = await search(async () => { throw new Error('boom') })
    expect(r.hits.map((h) => h.id)).toEqual(['p1'])
  })
})
