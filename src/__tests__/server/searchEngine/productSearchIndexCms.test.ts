/**
 * productSearchIndexCms.test.ts — CMS 전용 상품 검색 색인 회귀 테스트 (2026-11-16)
 *
 * 정책(products-full.md §2-12): 옵션 전용(option_only=true) 상품은 고객 검색·진열에서 제외하되,
 * 관리자는 CMS 검색에서 찾아 관리·옵션 연결을 해야 한다.
 *   - getProductSearchIndex()      : 고객용 — option_only=false 조건을 반드시 건다
 *   - getProductSearchIndexForCms(): CMS용 — option_only 조건을 걸지 않는다
 *   - 두 색인의 캐시는 분리되고, invalidateProductSearchCache()는 둘 다 비운다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type EqCall = { column: string; value: unknown }
const productEqCalls: EqCall[][] = []
let productsFromCount = 0

function makeChain(table: string, eqLog: EqCall[]): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        // await 시점: 상품 조회는 옵션 전용 1건이 들어 있는 것처럼, 나머지는 빈 결과
        const rows =
          table === 'products'
            ? [{ id: 'p1', name: 'L-Plate UN-A2', brand: 'Astro', category: 'accessorie', slug: 's' }]
            : []
        return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
      }
      if (prop === 'eq') {
        return (column: string, value: unknown) => {
          eqLog.push({ column, value })
          return proxy
        }
      }
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}

vi.mock('$lib/services/supabase', () => ({
  supabase: {
    from(table: string) {
      const eqLog: EqCall[] = []
      if (table === 'products') {
        productsFromCount++
        productEqCalls.push(eqLog)
      }
      return makeChain(table, eqLog)
    },
    rpc: () => makeChain('rpc', []),
  },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChain(table, []), rpc: () => makeChain('rpc', []) }),
}))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost', PUBLIC_SUPABASE_ANON_KEY: 'k' }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$lib/server/searchEngine/adapters/nlsearchParams', async () => {
  const schema = await import('$lib/server/searchEngine/adapters/nlsearchParamsSchema')
  return { loadNlsearchParams: async () => schema.DEFAULT_NLSEARCH_PARAMS }
})

import {
  getProductSearchIndex,
  getProductSearchIndexForCms,
  invalidateProductSearchCache,
} from '$lib/server/searchEngine/adapters/productSearchIndex'

const hasOptionOnlyFilter = (calls: EqCall[]): boolean =>
  calls.some((c) => c.column === 'option_only' && c.value === false)

describe('상품 검색 색인 — 고객용 vs CMS용', () => {
  beforeEach(() => {
    invalidateProductSearchCache()
    productEqCalls.length = 0
    productsFromCount = 0
  })

  it('고객용 색인은 option_only=false 조건을 건다', async () => {
    await getProductSearchIndex()
    expect(productEqCalls).toHaveLength(1)
    expect(hasOptionOnlyFilter(productEqCalls[0])).toBe(true)
  })

  it('CMS용 색인은 option_only 조건을 걸지 않는다(옵션 전용 상품 포함)', async () => {
    await getProductSearchIndexForCms()
    expect(productEqCalls).toHaveLength(1)
    expect(productEqCalls[0].some((c) => c.column === 'option_only')).toBe(false)
    // 그 외 공통 조건(활성)은 유지
    expect(productEqCalls[0].some((c) => c.column === 'is_active' && c.value === true)).toBe(true)
  })

  it('두 색인의 캐시가 분리된다 — CMS 색인을 만들어도 고객 색인은 따로 조회한다', async () => {
    await getProductSearchIndexForCms()
    await getProductSearchIndex()
    expect(productsFromCount).toBe(2)
    expect(hasOptionOnlyFilter(productEqCalls[1])).toBe(true)
  })

  it('같은 종류의 색인은 캐시를 재사용한다', async () => {
    await getProductSearchIndexForCms()
    await getProductSearchIndexForCms()
    expect(productsFromCount).toBe(1)
  })

  it('invalidateProductSearchCache()는 두 캐시를 모두 비운다', async () => {
    await getProductSearchIndex()
    await getProductSearchIndexForCms()
    expect(productsFromCount).toBe(2)
    invalidateProductSearchCache()
    await getProductSearchIndex()
    await getProductSearchIndexForCms()
    expect(productsFromCount).toBe(4)
  })
})
