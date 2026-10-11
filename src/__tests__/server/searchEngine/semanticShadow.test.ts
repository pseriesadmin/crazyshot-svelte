/**
 * semanticShadow.test.ts — B-4 그림자 기록의 안전 계약
 * 기본 꺼짐이면 아무것도 하지 않고, 어떤 실패도 던지지 않으며, 저장 행에는 숫자·불리언만 있다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  params: { semantic: { shadow: false, weight: 0 }, product: { fuzzy: 0.2, prefix: true } } as Record<string, unknown>,
  model: null as unknown,
  inserted: [] as Record<string, unknown>[],
  insertThrows: false,
  indexCalls: 0,
}

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'x' }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (state.insertThrows) throw new Error('db down')
        state.inserted.push(row)
        return { error: null }
      },
    }),
  }),
}))
vi.mock('$lib/server/searchEngine/adapters/nlsearchParams', () => ({ getNlsearchParamsCached: async () => state.params }))
vi.mock('$lib/server/searchEngine/adapters/semanticModelCache', () => ({ getSemanticModel: async () => state.model }))
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => {
    state.indexCalls++
    return {
      docs: [
        { id: 'p1', name: '셀카봉', brand: 'B', category: 'actcam', slug: 'selca', caption: '촬영 휴대폰 연장', keywords_text: '', category_label: '', components_text: '', specs_text: '' },
        { id: 'p2', name: '삼각대', brand: '', category: 'accessorie', slug: 'tri', caption: '고정 안정', keywords_text: '', category_label: '', components_text: '', specs_text: '' },
      ],
      search: () => [{ document: { id: 'p2' }, score: 5 }],
    }
  },
}))

import { buildSemanticModel } from '$lib/server/searchEngine/core/semanticVectors'
import { recordSemanticShadow, semanticFallbackCandidates, withTimeout } from '$lib/server/searchEngine/adapters/semanticShadow'

const model = buildSemanticModel(
  [
    { text: '셀카봉 촬영 휴대폰 연장' }, { text: '셀피스틱 촬영 휴대폰 연장' },
    { text: '삼각대 고정 안정 무게' }, { text: '삼각대 고정 안정 다리' },
  ],
  { dim: 32, minCount: 1 },
)

beforeEach(() => {
  state.params = { semantic: { shadow: false, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
  state.model = model
  state.inserted = []
  state.insertThrows = false
  state.indexCalls = 0
})

describe('recordSemanticShadow', () => {
  it('shadow 꺼짐(기본)이면 인덱스·모델·DB 어느 것도 건드리지 않는다', async () => {
    await recordSemanticShadow({ query: '셀피스틱', searchLogId: null, currentIds: ['p2'] })
    expect(state.indexCalls).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('켜져 있고 모델이 없으면 기록하지 않는다', async () => {
    state.params = { semantic: { shadow: true, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
    state.model = null
    await recordSemanticShadow({ query: '셀피스틱', searchLogId: null, currentIds: ['p2'] })
    expect(state.inserted).toHaveLength(0)
  })

  it('켜져 있으면 숫자·불리언만 담은 한 행을 남기고 weight 0이면 관찰용 0.3을 쓴다', async () => {
    state.params = { semantic: { shadow: true, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
    await recordSemanticShadow({ query: '셀피스틱', searchLogId: 'log-1', currentIds: ['p2'], sampleRate: 1 })
    expect(state.inserted).toHaveLength(1)
    const row = state.inserted[0]
    expect(row.weight).toBe(0.3)
    expect(row.search_log_id).toBe('log-1')
    expect(row.query_chars).toBe(4)
    for (const [k, v] of Object.entries(row)) {
      expect(['number', 'boolean', 'string'].includes(typeof v) || v === null, k).toBe(true)
    }
    expect(JSON.stringify(row)).not.toContain('셀피스틱')
    expect(JSON.stringify(row)).not.toContain('삼각대')
  })

  it('한 글자 질의는 기록하지 않는다', async () => {
    state.params = { semantic: { shadow: true, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
    await recordSemanticShadow({ query: '렌', searchLogId: null, currentIds: [] })
    expect(state.inserted).toHaveLength(0)
  })

  it('DB 기록이 실패해도 예외를 던지지 않는다', async () => {
    state.params = { semantic: { shadow: true, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
    state.insertThrows = true
    await expect(recordSemanticShadow({ query: '셀피스틱', searchLogId: null, currentIds: ['p2'], sampleRate: 1 })).resolves.toBeUndefined()
  })
})

describe('표본·시간 제한', () => {
  it('표본 비율 0이면 켜져 있어도 기록하지 않는다', async () => {
    state.params = { semantic: { shadow: true, weight: 0 }, product: { fuzzy: 0.2, prefix: true } }
    await recordSemanticShadow({ query: '셀피스틱', searchLogId: null, currentIds: ['p2'], sampleRate: 0 })
    expect(state.inserted).toHaveLength(0)
  })

  it('withTimeout: 느린 작업은 fallback으로 먼저 돌아오고, 예외는 삼킨다', async () => {
    expect(await withTimeout(new Promise<string>((r) => setTimeout(() => r('late'), 200)), 20, 'fb')).toBe('fb')
    expect(await withTimeout(Promise.resolve('ok'), 100, 'fb')).toBe('ok')
    expect(await withTimeout(Promise.reject(new Error('x')), 100, 'fb')).toBe('fb')
  })
})

describe('semanticFallbackCandidates (B-5, 기본 꺼짐)', () => {
  it('weight 0이면 항상 빈 배열(기존과 동일)', async () => {
    expect(await semanticFallbackCandidates({ query: '셀카봉 촬영 휴대폰', excludeIds: new Set() })).toEqual([])
  })

  it('weight > 0이면 이미 나온 상품을 뺀 새 후보를 돌려준다', async () => {
    state.params = { semantic: { shadow: false, weight: 0.3 }, product: { fuzzy: 0.2, prefix: true } }
    const r = await semanticFallbackCandidates({ query: '셀카봉 촬영 휴대폰', excludeIds: new Set(['p2']) })
    expect(r.map((x) => x.id)).toEqual(['p1'])
    expect(r[0]).toMatchObject({ name: '셀카봉', slug: 'selca', category: 'actcam' })
    expect(await semanticFallbackCandidates({ query: '셀카봉 촬영 휴대폰', excludeIds: new Set(['p1', 'p2']) })).toEqual([])
  })

  it('모델이 없거나 질의가 짧으면 빈 배열', async () => {
    state.params = { semantic: { shadow: false, weight: 0.3 }, product: { fuzzy: 0.2, prefix: true } }
    state.model = null
    expect(await semanticFallbackCandidates({ query: '셀카봉 촬영 휴대폰', excludeIds: new Set() })).toEqual([])
    state.model = model
    expect(await semanticFallbackCandidates({ query: '셀', excludeIds: new Set() })).toEqual([])
  })
})
