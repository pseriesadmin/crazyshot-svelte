import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 동의어 단어 단위 치환 — 고객 검색 API(/api/search/products) 핸들러 직접 호출 테스트 (2026-10-08)
 *
 * 핵심:
 *   1. "소니 카메라"처럼 여러 단어 검색어에서 단어 하나를 동의어로 바꾼 변형("Sony 카메라")이 MiniSearch로 검색된다
 *   2. 변형은 검색 RPC(search_products)를 다시 부르지 않는다 — 호출마다 search_logs가 쌓여 인기 검색어에 섞이므로
 *   3. 변형 결과가 원문 결과보다 먼저 들어간다(원문이 limit을 먼저 채워 밀려나지 않게)
 *   4. 동의어 그룹이 없으면 기존과 동일(RPC 1회, MiniSearch는 원문만)
 *   5. 검색어 전체가 동의어인 기존 경로(whole)는 RPC 재조회를 그대로 한다
 *   6. 1차 RPC 결과가 충분하면(>3건) 확장 자체를 실행하지 않는다(기존 한계 유지)
 *   7. 동의어 로드가 실패해도 기존 결과를 돌려준다(서비스 중단 없음)
 *
 * CMS 검색 제안(/api/cms/products/search-suggestions) 핸들러도 같은 방식으로 직접 호출한다(파일 하단 describe):
 *   변형어는 ilike(.or) 재조회에 쓰이지 않고 MiniSearch로만 검색 / 변형이 원문보다 먼저 / match_label '키워드·상세' 유지 /
 *   동의어 없으면 기존 순서
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
let rpcRows: Record<string, unknown>[] = []
vi.mock('$lib/services/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      // 확장어로 재조회한 호출은 별도 행을 돌려줄 수 있게 query별 응답 지원
      const byQuery = rpcByQuery[String(args.p_query)]
      return { data: byQuery ?? rpcRows, error: null }
    },
  },
}))
let rpcByQuery: Record<string, Record<string, unknown>[]> = {}

// 로그 후속 조회(0건일 때)는 이 테스트의 관심사가 아님 — null 반환
// 체인 호출(.from().select().or()…)을 전부 받아 기록하고, await하면 빈 결과를 돌려주는 만능 프록시.
// 고객 API의 로그 후속 조회(maybeSingle)와 CMS 제안의 ilike 체인을 모두 만족시킨다.
const orFilters: string[] = []
function chainProxy(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
      if (prop === 'maybeSingle') return async () => ({ data: null })
      if (prop === 'or') return (filter: string) => { orFilters.push(filter); return proxy }
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => chainProxy() }),
}))

// 보조 조회(위시·가격·판매)는 빈 값
vi.mock('$lib/server/getWishedProductIds', () => ({ getWishedProductIds: async () => [] }))
vi.mock('$lib/server/getPriceMinForProducts', () => ({ getPriceMinForProducts: async () => ({}) }))
vi.mock('$lib/server/getPrice12hForProducts', () => ({ getPrice12hForProducts: async () => ({}) }))

let groups: Array<{ canonicalTerm: string; confirmedTerms: string[] }> = []
let groupsShouldThrow = false
vi.mock('$lib/server/synonymLearning', () => ({
  loadSynonymGroups: async () => {
    if (groupsShouldThrow) throw new Error('boom')
    return groups
  },
}))

const miniSearchCalls: string[] = []
let miniByQuery: Record<string, Array<Record<string, unknown>>> = {}
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => ({
    search: (q: string) => {
      miniSearchCalls.push(q)
      return (miniByQuery[q] ?? []).map((doc) => ({ document: doc, score: 1, terms: [], queryTerms: [] }))
    },
  }),
}))


// ── CMS 검색 제안 핸들러용 모킹 ───────────────────────────────────────────────
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/products/searchByProductCode', () => ({ findParentIdsByProductCode: async () => [] }))

import { GET } from '../../routes/api/search/products/+server'
import { GET as cmsGET } from '../../routes/api/cms/products/search-suggestions/+server'

const doc = (id: string, name: string) => ({ id, name, brand: '', category: 'camera', slug: `s-${id}` })

async function call(q: string, limit = 20): Promise<{ results: Array<Record<string, unknown>> }> {
  const url = new URL(`https://example.com/api/search/products?q=${encodeURIComponent(q)}&limit=${limit}`)
  const locals = {
    safeGetSession: async () => ({ session: null }),
    supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) },
  }
  const res = await GET({ url, locals } as unknown as Parameters<typeof GET>[0])
  return (res as Response).json()
}
const ids = (r: { results: Array<Record<string, unknown>> }): string[] => r.results.map((x) => String(x['product_id'] ?? x['id']))

const SONY = [{ canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] }]

beforeEach(() => {
  rpcCalls.length = 0
  miniSearchCalls.length = 0
  orFilters.length = 0
  rpcRows = []
  rpcByQuery = {}
  miniByQuery = {}
  groups = []
  groupsShouldThrow = false
})

describe('/api/search/products — 동의어 단어 단위 치환', () => {
  it('여러 단어 검색어는 단어를 동의어로 바꾼 변형을 MiniSearch로 검색하고, 검색 RPC는 원문으로 1회만 부른다', async () => {
    groups = SONY
    miniByQuery = { 'Sony 카메라': [doc('sony-1', 'Sony FX6')] }
    const r = await call('소니 카메라')
    expect(ids(r)).toContain('sony-1')
    expect(miniSearchCalls).toContain('Sony 카메라')
    // 로그 오염 방지: 변형어로 검색 RPC를 다시 부르지 않는다
    expect(rpcCalls.map((c) => c.args.p_query)).toEqual(['소니 카메라'])
  })

  it('변형 결과는 원문 결과보다 먼저 들어간다(원문이 limit을 채워도 밀리지 않음)', async () => {
    groups = SONY
    miniByQuery = {
      '소니 카메라': [doc('cam-1', '일반 카메라 A'), doc('cam-2', '일반 카메라 B'), doc('cam-3', '일반 카메라 C')],
      'Sony 카메라': [doc('sony-1', 'Sony FX6')],
    }
    const r = await call('소니 카메라', 2)
    // limit=2: 변형(sony-1)이 먼저 들어가고 원문 결과가 나머지를 채운다
    expect(ids(r)[0]).toBe('sony-1')
    expect(ids(r)).toHaveLength(2)
  })

  it('1차 RPC 결과가 항상 앞에 온다(변형·원문 폴백은 뒤에 보강)', async () => {
    groups = SONY
    rpcRows = [{ product_id: 'rpc-1', name: 'RPC 결과', search_log_id: 'log-1' }]
    miniByQuery = { 'Sony 카메라': [doc('sony-1', 'Sony FX6')] }
    const r = await call('소니 카메라')
    expect(ids(r)).toEqual(['rpc-1', 'sony-1'])
  })

  it('동의어 그룹이 없으면 기존과 동일 — RPC 1회, MiniSearch는 원문만', async () => {
    groups = []
    miniByQuery = { '소니 카메라': [doc('cam-1', '일반 카메라')] }
    const r = await call('소니 카메라')
    expect(rpcCalls).toHaveLength(1)
    expect(miniSearchCalls).toEqual(['소니 카메라'])
    expect(ids(r)).toEqual(['cam-1'])
  })

  it('검색어 전체가 동의어인 기존 경로는 확장어로 검색 RPC를 다시 부르고 MiniSearch 순서도 [원문, 확장어] 그대로', async () => {
    groups = SONY
    rpcByQuery = { 소니: [], Sony: [{ product_id: 'rpc-sony', name: 'Sony RPC', search_log_id: 'l2' }] }
    miniByQuery = { 소니: [doc('m-1', '소니 로컬')] }
    const r = await call('소니')
    expect(rpcCalls.map((c) => c.args.p_query)).toEqual(['소니', 'Sony'])
    expect(miniSearchCalls[0]).toBe('소니')
    expect(ids(r)).toContain('rpc-sony')
  })

  it('1차 RPC 결과가 충분하면(>3건) 확장도 폴백도 실행하지 않는다(기존 한계 유지)', async () => {
    groups = SONY
    rpcRows = [1, 2, 3, 4].map((n) => ({ product_id: `rpc-${n}`, name: `RPC ${n}`, search_log_id: 'l' }))
    await call('소니 카메라')
    expect(miniSearchCalls).toHaveLength(0)
    expect(rpcCalls).toHaveLength(1)
  })

  it('동의어 로드가 실패해도 기존 결과를 돌려주고 원문 MiniSearch 폴백은 계속된다', async () => {
    groupsShouldThrow = true
    miniByQuery = { '소니 카메라': [doc('cam-1', '일반 카메라')] }
    const r = await call('소니 카메라')
    expect(ids(r)).toEqual(['cam-1'])
  })

  it('단어가 하나뿐이면 변형 없이 기존 whole 경로만 쓴다', async () => {
    groups = SONY
    const r = await call('소니')
    expect(r.results).toEqual([])
    expect(miniSearchCalls.filter((q) => q.includes(' '))).toEqual([])
  })
})

async function cmsCall(q: string, limit = 8): Promise<Array<{ id: string; match_label?: string | null }>> {
  const url = new URL(`https://example.com/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=${limit}`)
  const res = (await cmsGET({ url, locals: {} } as unknown as Parameters<typeof cmsGET>[0])) as Response
  return res.json()
}

describe('/api/cms/products/search-suggestions — 동의어 단어 단위 치환', () => {
  it('변형은 MiniSearch로만 검색되고 ilike(.or) 재조회에는 쓰이지 않으며, 변형이 원문보다 먼저 검색된다', async () => {
    groups = SONY
    miniByQuery = { 'Sony 카메라': [doc('sony-1', 'Sony FX6')] }
    const items = await cmsCall('소니 카메라')
    expect(items.map((i) => i.id)).toContain('sony-1')
    expect(miniSearchCalls.slice(0, 2)).toEqual(['Sony 카메라', '소니 카메라'])
    // ilike 필터는 원문 한 번뿐 — 변형어("Sony 카메라")는 어떤 DB 필터에도 들어가지 않는다
    expect(orFilters.length).toBe(1)
    expect(orFilters.join('|').includes('Sony')).toBe(false)
  })

  it('MiniSearch로 들어온 항목은 match_label "키워드·상세"를 유지한다(썸네일 보강 로직이 이 라벨로 식별)', async () => {
    groups = SONY
    miniByQuery = { 'Sony 카메라': [doc('sony-1', 'Sony FX6')] }
    const items = await cmsCall('소니 카메라')
    expect(items.find((i) => i.id === 'sony-1')?.match_label).toBe('키워드·상세')
  })

  it('변형 결과가 원문 결과보다 앞에 온다(limit이 작아도 밀리지 않음)', async () => {
    groups = SONY
    miniByQuery = {
      '소니 카메라': [doc('cam-1', '일반 카메라 A'), doc('cam-2', '일반 카메라 B')],
      'Sony 카메라': [doc('sony-1', 'Sony FX6')],
    }
    const items = await cmsCall('소니 카메라', 1)
    expect(items.map((i) => i.id)).toEqual(['sony-1'])
  })

  it('동의어 그룹이 없으면 MiniSearch는 원문만 검색한다(기존과 동일)', async () => {
    groups = []
    miniByQuery = { '소니 카메라': [doc('cam-1', '일반 카메라')] }
    const items = await cmsCall('소니 카메라')
    expect(miniSearchCalls).toEqual(['소니 카메라'])
    expect(items.map((i) => i.id)).toEqual(['cam-1'])
  })

  it('검색어 전체가 동의어인 기존 경로는 확장어로 ilike를 다시 조회한다(whole은 기존 동작 유지)', async () => {
    groups = SONY
    await cmsCall('소니')
    // 원문 + 확장어('Sony') 두 번의 ilike 조회
    expect(orFilters.length).toBe(2)
    expect(orFilters[1].includes('Sony')).toBe(true)
  })
})
