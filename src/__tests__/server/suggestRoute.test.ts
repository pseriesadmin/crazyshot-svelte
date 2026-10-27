import { beforeEach, describe, expect, it, vi } from 'vitest'

// 검색창 자동완성 API 핸들러 회귀 (2026-10-27, sp3 MINOR-4) — 동의어가 없으면 기존 index.search 결과와 같고,
// 있으면 원문(fuzzy 0.2)·동의어(fuzzy 0)로 각각 검색하며, 응답 키·limit 상한·질의 길이 상한이 유지되는지 고정한다.

const search = vi.fn()
const loadSynonymGroups = vi.fn()

vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => ({ search }),
}))
vi.mock('$lib/server/getPriceMinForProducts', () => ({
  getPriceMinForProducts: async () => ({}),
}))
vi.mock('$lib/server/synonymLearning', () => ({
  loadSynonymGroups: () => loadSynonymGroups(),
}))

import { GET } from '../../routes/api/search/suggest/+server'

function hit(id: string, name: string) {
  return { document: { id, name, slug: id, category: 'camera' }, score: 1, terms: [], queryTerms: [] }
}

const locals = {
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) },
}

async function call(qs: string): Promise<{ results: { id: string; name: string }[]; query: string; limit: number }> {
  const url = new URL(`http://localhost/api/search/suggest?${qs}`)
  const res = await GET({ url, locals } as unknown as Parameters<typeof GET>[0])
  return (res as Response).json()
}

beforeEach(() => {
  search.mockReset()
  loadSynonymGroups.mockReset()
})

describe('/api/search/suggest 핸들러 회귀', () => {
  it('(a) 동의어 로드 실패·빈 배열이면 기존 index.search 결과와 같다 (원문 1회, fuzzy 0.2·prefix·limit)', async () => {
    const hits = [hit('p1', 'Sony A'), hit('p2', 'Sony B')]
    for (const loader of [() => Promise.reject(new Error('db down')), () => Promise.resolve([])]) {
      search.mockReset()
      search.mockReturnValue(hits)
      loadSynonymGroups.mockImplementation(loader)
      const body = await call('q=소니&limit=8')
      expect(search).toHaveBeenCalledTimes(1)
      expect(search).toHaveBeenCalledWith('소니', { fuzzy: 0.2, prefix: true, limit: 8 })
      expect(body.results.map((r) => r.id)).toEqual(['p1', 'p2'])
    }
  })

  it('(b) 동의어가 있으면 원문(fuzzy 0.2)과 동의어(fuzzy 0)로 각각 검색하고 결과를 섞는다', async () => {
    loadSynonymGroups.mockResolvedValue([{ canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] }])
    search.mockImplementation((term: string) => (term === '소니' ? [hit('k1', '소니 NP')] : [hit('e1', 'Sony PXW'), hit('e2', 'Sony UWP')]))
    const body = await call('q=소니&limit=8')
    expect(search).toHaveBeenCalledWith('소니', { fuzzy: 0.2, prefix: true, limit: 8 })
    expect(search).toHaveBeenCalledWith('Sony', { fuzzy: 0, prefix: true, limit: 8 })
    expect(body.results.map((r) => r.id)).toEqual(['k1', 'e1', 'e2'])
  })

  it('(c) 응답 키(results·query·limit)와 limit 상한 20·하한 1이 유지된다', async () => {
    loadSynonymGroups.mockResolvedValue([])
    search.mockReturnValue([hit('p1', 'Sony A')])
    const big = await call('q=소니&limit=999')
    expect(Object.keys(big).sort()).toEqual(['limit', 'query', 'results'])
    expect(big.limit).toBe(20)
    expect(search).toHaveBeenCalledWith('소니', { fuzzy: 0.2, prefix: true, limit: 20 })
    const small = await call('q=소니&limit=0')
    expect(small.limit).toBe(1)
  })

  it('2자 미만·100자 초과 검색어는 검색하지 않고 빈 결과', async () => {
    loadSynonymGroups.mockResolvedValue([])
    expect((await call('q=소')).results).toEqual([])
    expect((await call(`q=${'가'.repeat(101)}`)).results).toEqual([])
    expect(search).not.toHaveBeenCalled()
    search.mockReturnValue([])
    await call(`q=${'가'.repeat(100)}`)
    expect(search).toHaveBeenCalledTimes(1)
  })
})
