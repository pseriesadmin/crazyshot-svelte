// cmsSearchSuggestionsPaged.test.ts — 채팅 상품 검색 무한 스크롤(search-suggestions API 페이지 모드)
// 후보 최대 500건 · 페이지 단위 슬라이스 · 다음 페이지 헤더 · 후보 조회 캐시 · offset 없는 기존 호출 무영향
import { describe, it, expect, vi, beforeEach } from 'vitest'

type PoolRow = { id: string; name: string; brand: string | null; category: string | null; product_code: string | null; description: string | null; product_caption: string | null }

const state = vi.hoisted(() => ({
  pool: [] as unknown[],
  poolCalls: 0,
  poolLimit: 0,
  poolSelect: '',
  thumbCalls: 0,
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/products/searchByProductCode', () => ({ findParentIdsByProductCode: async () => [] }))
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({ getProductSearchIndex: async () => ({ search: () => [] }) }))
vi.mock('$lib/server/synonymLearning', () => ({ loadSynonymGroups: async () => [] }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = { table, usedIn: false, limitVal: 0, selectVal: '' }
      const chain = new Proxy(q, {
        get(target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              if (table === 'products' && target.usedIn) { state.thumbCalls++; resolve({ data: (state.pool as PoolRow[]).map((r) => ({ id: r.id, image_urls: [`img-${r.id}`], slug: `slug-${r.id}` })), error: null }) }
              else if (table === 'products') { state.poolCalls++; state.poolLimit = target.limitVal as number; state.poolSelect = target.selectVal as string; resolve({ data: state.pool.slice(0, target.limitVal as number), error: null }) }
              else resolve({ data: [], error: null })
            }
          }
          return (...args: unknown[]) => {
            if (prop === 'in') target.usedIn = true
            if (prop === 'limit') target.limitVal = args[0]
            if (prop === 'select') target.selectVal = args[0]
            return chain
          }
        },
      })
      return chain
    },
    rpc: async () => ({ error: null }),
  }),
}))

import { GET } from '../../routes/api/cms/products/search-suggestions/+server'

function makePool(n: number): PoolRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(4, '0')}`, name: `카메라 ${String(i).padStart(4, '0')}`, brand: '소니',
    category: 'camera', product_code: null, description: null, product_caption: null,
  }))
}

async function call(qs: string): Promise<{ items: Array<{ id: string; image_url: string | null; price_24h: number | null }>; hasMore: string | null }> {
  const url = new URL(`http://localhost/api/cms/products/search-suggestions?${qs}`)
  const res = await GET({ url, locals: {} } as unknown as Parameters<typeof GET>[0])
  return { items: await res.json(), hasMore: res.headers.get('x-has-more') }
}

beforeEach(() => { state.poolCalls = 0; state.thumbCalls = 0; state.pool = makePool(95) })

describe('search-suggestions 페이지 모드', () => {
  it('offset=0 첫 페이지: limit건만 내려주고 다음 페이지가 있으면 x-has-more=1', async () => {
    const r = await call('q=카메라%20' + Date.now() + '&limit=20&offset=0')
    expect(r.items).toHaveLength(20)
    expect(r.hasMore).toBe('1')
  })

  it('후보는 가벼운 칼럼으로 최대 500건만 읽는다(이미지·슬러그는 페이지 건만 추가 조회)', async () => {
    await call('q=가벼운검색' + Date.now() + '&limit=20&offset=0')
    expect(state.poolLimit).toBe(500)
    expect(state.poolSelect).not.toContain('image_urls')
    expect(state.thumbCalls).toBe(1)
  })

  it('마지막 페이지는 남은 건만, x-has-more=0', async () => {
    const q = `q=마지막${Date.now()}`
    const p = await call(`${q}&limit=40&offset=80`)
    expect(p.items).toHaveLength(15)
    expect(p.hasMore).toBe('0')
  })

  it('범위를 넘는 offset은 빈 배열 + x-has-more=0', async () => {
    const r = await call(`q=범위${Date.now()}&limit=20&offset=9999`)
    expect(r.items).toEqual([])
    expect(r.hasMore).toBe('0')
  })

  it('같은 검색어의 다음 페이지는 후보를 다시 읽지 않는다(캐시)', async () => {
    const q = `q=캐시${Date.now()}`
    await call(`${q}&limit=20&offset=0`)
    await call(`${q}&limit=20&offset=20`)
    await call(`${q}&limit=20&offset=40`)
    expect(state.poolCalls).toBe(1)
  })

  it('페이지가 겹치지 않는다(전체를 이어 붙이면 중복 없이 후보 전체)', async () => {
    const q = `q=이어붙임${Date.now()}`
    const ids: string[] = []
    for (let off = 0; off < 100; off += 20) {
      const r = await call(`${q}&limit=20&offset=${off}`)
      ids.push(...r.items.map((i) => i.id))
    }
    expect(ids).toHaveLength(95)
    expect(new Set(ids).size).toBe(95)
  })

  it('페이지 한 번에 최대 40건으로 제한된다', async () => {
    const r = await call(`q=상한${Date.now()}&limit=999&offset=0`)
    expect(r.items).toHaveLength(40)
  })

  it('offset이 없으면 기존 동작: 최대 20건, 페이지 헤더 없음', async () => {
    const r = await call(`q=기존${Date.now()}&limit=999`)
    expect(r.items.length).toBeLessThanOrEqual(20)
    expect(r.hasMore).toBeNull()
  })

  it('약한 매칭(3건 이하)의 첫 페이지는 기존 보강 경로로 처리되어 다음 페이지 없음', async () => {
    state.pool = makePool(2)
    const r = await call(`q=약한${Date.now()}&limit=20&offset=0`)
    expect(r.items).toHaveLength(2)
    expect(r.hasMore).toBe('0')
  })
})
