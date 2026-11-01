import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 검색 API(/api/search/products) 보충 결과의 상품 이미지 채움 — 핸들러 직접 호출 테스트 (2026-11-01)
 *
 * 배경: 1차 RPC 결과가 3건 이하이면 붙는 보충 결과(MiniSearch 자연어 폴백)에는 image_urls 가 없어,
 * 등록된 상품인데도 검색 화면에 "등록 안 된 기본 이미지"가 보였다(bam·Rode·Sam·San 검색에서 발견).
 * 보충 결과 중 이미지가 없는 행만 products.image_urls 배치 조회로 채우고, RPC 행(이미지 보유)은 그대로 둔다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

let rpcRows: Record<string, unknown>[] = []
vi.mock('$lib/services/supabase', () => ({
  supabase: { rpc: async () => ({ data: rpcRows, error: null }) },
}))

function chainProxy(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
      if (prop === 'maybeSingle') return async () => ({ data: null })
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => chainProxy() }) }))

vi.mock('$lib/server/getWishedProductIds', () => ({ getWishedProductIds: async () => [] }))
vi.mock('$lib/server/getPriceMinForProducts', () => ({ getPriceMinForProducts: async () => ({}) }))
vi.mock('$lib/server/getPrice12hForProducts', () => ({ getPrice12hForProducts: async () => ({}) }))
vi.mock('$lib/server/synonymLearning', () => ({ loadSynonymGroups: async () => [] }))

let miniDocs: Array<Record<string, unknown>> = []
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => ({
    search: () => miniDocs.map((doc) => ({ document: doc, score: 1, terms: [], queryTerms: [] })),
  }),
}))

// 의미 후보(semantic) — 테스트가 후보 목록을 정한다. 나머지(withTimeout 등)는 실제 구현 그대로
let semanticCands: Array<Record<string, unknown>> = []
vi.mock('$lib/server/searchEngine/adapters/semanticShadow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/searchEngine/adapters/semanticShadow')>()
  return {
    ...actual,
    semanticFallbackCandidates: async () => semanticCands,
    recordSemanticShadow: async () => undefined,
  }
})

import { GET } from '../../routes/api/search/products/+server'

// products 조회(.from('products').select(..).in(..))가 받은 열 목록과 id 를 기록하고 준비한 행을 돌려준다
let imageRows: Array<{ id: string; image_urls: unknown }> = []
let imageQueryError: { message: string } | null = null
const productSelects: Array<{ cols: string; ids: string[] }> = []
function makeLocals() {
  return {
    safeGetSession: async () => ({ session: null }),
    supabase: {
      from: (table: string) => ({
        select: (cols: string) => ({
          in: async (_col: string, ids: string[]) => {
            if (table === 'products') productSelects.push({ cols, ids })
            if (table === 'products' && cols.includes('image_urls') && imageQueryError) return { data: null, error: imageQueryError }
            return { data: table === 'products' && cols.includes('image_urls') ? imageRows : [], error: null }
          },
        }),
      }),
    },
  }
}

async function call(q: string, limit?: number): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`https://example.com/api/search/products?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`)
  const res = await GET({ url, locals: makeLocals() } as unknown as Parameters<typeof GET>[0])
  return ((await (res as Response).json()) as { results: Array<Record<string, unknown>> }).results
}
const byId = (rs: Array<Record<string, unknown>>, id: string) => rs.find((r) => String(r['product_id'] ?? r['id']) === id)!
const doc = (id: string, name: string) => ({ id, name, brand: '', category: 'camera', slug: `s-${id}` })

beforeEach(() => {
  rpcRows = []
  miniDocs = []
  imageRows = []
  imageQueryError = null
  semanticCands = []
  productSelects.length = 0
})

describe('/api/search/products — 보충 결과 이미지 채움', () => {
  it('RPC 결과가 없어 전부 보충(자연어 폴백)으로 나온 경우에도 상품 이미지가 붙는다', async () => {
    miniDocs = [doc('p1', 'Rode Wireless GO'), doc('p2', 'Rode NT1')]
    imageRows = [
      { id: 'p1', image_urls: ['https://cdn/p1-a.jpg', 'https://cdn/p1-b.jpg'] },
      { id: 'p2', image_urls: ['https://cdn/p2-a.jpg'] },
    ]
    const results = await call('Rode')
    expect(byId(results, 'p1')['image_urls']).toEqual(['https://cdn/p1-a.jpg', 'https://cdn/p1-b.jpg'])
    expect(byId(results, 'p2')['image_urls']).toEqual(['https://cdn/p2-a.jpg'])
  })

  it('RPC 행은 이미지가 이미 있으니 덮어쓰지 않고 조회 대상에서도 뺀다(보충 행만 조회)', async () => {
    rpcRows = [{ product_id: 'rpc-1', name: 'RPC 결과', image_urls: ['https://cdn/rpc.jpg'], search_log_id: 'log-1' }]
    miniDocs = [doc('p9', 'Sam 보충')]
    imageRows = [{ id: 'p9', image_urls: ['https://cdn/p9.jpg'] }]
    const results = await call('Sam')
    expect(byId(results, 'rpc-1')['image_urls']).toEqual(['https://cdn/rpc.jpg'])
    expect(byId(results, 'p9')['image_urls']).toEqual(['https://cdn/p9.jpg'])
    const imageQuery = productSelects.find((s) => s.cols.includes('image_urls'))!
    expect(imageQuery.ids).toEqual(['p9'])
  })

  it('image_url(단수)만 가진 RPC 행도 이미지가 있는 것으로 보고 조회하지 않는다', async () => {
    rpcRows = [{ product_id: 'rpc-1', name: '단수 이미지', image_url: 'https://cdn/one.jpg', search_log_id: 'log-1' }]
    const results = await call('San')
    expect(byId(results, 'rpc-1')['image_urls']).toBeUndefined()
    expect(productSelects.some((s) => s.cols.includes('image_urls'))).toBe(false)
  })

  it('등록된 이미지가 없는 상품은 image_urls 를 만들지 않는다(화면이 기존 기본 이미지로 표시)', async () => {
    miniDocs = [doc('p1', 'Rode 이미지없음')]
    imageRows = [{ id: 'p1', image_urls: [] }]
    const results = await call('Rode')
    expect(byId(results, 'p1')['image_urls']).toBeUndefined()
  })

  it('의미 후보(semantic) 행에도 이미지가 붙는다 — 자연어 폴백 행과 함께 한 번에 조회', async () => {
    miniDocs = [doc('p1', 'Rode 자연어')]
    semanticCands = [{ id: 's1', name: '의미 후보' }]
    imageRows = [
      { id: 'p1', image_urls: ['https://cdn/p1.jpg'] },
      { id: 's1', image_urls: ['https://cdn/s1.jpg'] },
    ]
    const results = await call('Rode')
    expect(byId(results, 'p1')['image_urls']).toEqual(['https://cdn/p1.jpg'])
    expect(byId(results, 's1')['image_urls']).toEqual(['https://cdn/s1.jpg'])
    expect(byId(results, 's1')['_source']).toBe('semantic')
    const imageQueries = productSelects.filter((s) => s.cols.includes('image_urls'))
    expect(imageQueries).toHaveLength(1)
    expect([...imageQueries[0].ids].sort()).toEqual(['p1', 's1'])
  })

  it('이미지 조회가 실패해도 검색 결과는 그대로 응답한다(이미지만 없음 → 화면이 기본 이미지 유지)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    miniDocs = [doc('p1', 'Rode A'), doc('p2', 'Rode B')]
    imageQueryError = { message: 'boom' }
    const results = await call('Rode')
    expect(results.map((r) => String(r['product_id']))).toEqual(['p1', 'p2'])
    expect(byId(results, 'p1')['image_urls']).toBeUndefined()
    expect(byId(results, 'p2')['image_urls']).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('결과가 limit 으로 잘리면 잘려 나간 행의 이미지는 조회하지 않는다', async () => {
    miniDocs = [doc('p1', '첫째'), doc('p2', '둘째'), doc('p3', '셋째')]
    imageRows = [
      { id: 'p1', image_urls: ['https://cdn/p1.jpg'] },
      { id: 'p2', image_urls: ['https://cdn/p2.jpg'] },
      { id: 'p3', image_urls: ['https://cdn/p3.jpg'] },
    ]
    const results = await call('Rode', 1)
    expect(results).toHaveLength(1)
    const imageQuery = productSelects.find((s) => s.cols.includes('image_urls'))!
    expect(imageQuery.ids).toEqual(['p1'])
  })
})
