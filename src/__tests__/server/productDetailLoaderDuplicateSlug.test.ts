/**
 * 상품 상세 로더 — 삭제된 상품이 같은 주소(slug)를 남겨 둔 경우의 회귀 테스트 (2026-10-08)
 *
 * 실서버 사고: 9/23에 만든 부모 상품이 9/27에 삭제(soft delete)되고 같은 주소로 다시 만들어지자,
 * CMS 관리자 계정(RLS가 삭제된 행까지 허용)이 `/products/<주소>`를 열 때 "한 줄만 기대"하는 조회가
 * 두 줄을 만나 오류(JSON object requested, multiple rows returned)가 났고 화면에는 503이 표시됐다.
 * 로더가 접근 규칙(RLS)에만 기대지 않고 `deleted_at IS NULL`을 직접 걸어야 한다.
 *
 * 관리자 세션을 흉내 내기 위해 가짜 DB는 RLS 없이 모든 행을 돌려주고, 쿼리에 걸린 필터만 적용한다.
 */
import { describe, it, expect, vi } from 'vitest'

type Row = Record<string, unknown>
type Filter = ['eq' | 'is', string, unknown]

const SLUG = 'dup-slug-2609'
const LIVE_ID = '11111111-1111-4111-8111-111111111111'
const DELETED_ID = '22222222-2222-4222-8222-222222222222'

const productRows: Row[] = [
  { id: DELETED_ID, slug: SLUG, name: '삭제된 옛 상품', is_active: true, deleted_at: '2026-09-27T01:02:53Z', parent_product_id: null, category: 'product' },
  { id: LIVE_ID, slug: SLUG, name: '정상 상품', is_active: true, deleted_at: null, parent_product_id: null, category: 'product' },
]

const productQueryFilters: Filter[][] = []

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([op, col, val]) => (op === 'eq' ? row[col] === val : (row[col] ?? null) === val))
}

function makeSupabase() {
  const from = (table: string) => {
    const filters: Filter[] = []
    if (table === 'products') productQueryFilters.push(filters)
    const result = (mode: 'maybe' | 'single' | 'list') => {
      if (table !== 'products') {
        return mode === 'list' ? { data: [], error: null } : { data: null, error: null }
      }
      const found = productRows.filter((r) => matches(r, filters))
      if (mode === 'list') return { data: found, error: null }
      if (found.length > 1) {
        return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
      }
      return { data: found[0] ?? null, error: null }
    }
    const target: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return proxy },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return proxy },
      maybeSingle: async () => result('maybe'),
      single: async () => result('single'),
      then: (res: (v: unknown) => unknown) => res(result('list')),
    }
    const proxy: unknown = new Proxy(target, {
      get: (t, key: string) => (key in t ? t[key] : () => proxy),
    })
    return proxy
  }
  return { from, rpc: async () => ({ data: [], error: null }) }
}

vi.mock('$app/environment', () => ({ dev: false, browser: false, building: false }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => makeSupabase() }))
vi.mock('$lib/server/productCategorySettings', () => ({
  getCategoryGroups: async () => [],
  joinDisplayCategories: () => [],
}))
vi.mock('$lib/server/getWishedProductIds', () => ({ getWishedProductIds: async () => [] }))

const { load } = await import('../../routes/products/[id]/+page.server')

type LoadEvent = Parameters<typeof load>[0]

function event(id: string): LoadEvent {
  return {
    params: { id },
    locals: { safeGetSession: async () => ({ session: null }), supabase: makeSupabase() },
  } as unknown as LoadEvent
}

async function run(id: string): Promise<{ status?: number; thrown?: unknown; data?: unknown }> {
  try {
    return { data: await load(event(id)) }
  } catch (e) {
    const status = (e as { status?: number }).status
    return { status, thrown: e }
  }
}

describe('[회귀] 상품 상세 로더 — 삭제된 상품이 같은 주소를 가진 경우', () => {
  it('DS-1 같은 주소의 삭제된 부모가 있어도 503이 아니라 정상 상품이 로드된다 (관리자 세션 흉내)', async () => {
    const r = await run(SLUG)
    expect(r.status).not.toBe(503)
    expect(r.status).toBeUndefined()
    const data = r.data as { product?: { id?: string } } | undefined
    expect(data?.product?.id).toBe(LIVE_ID)
  })

  it('DS-2 조회에 deleted_at IS NULL 필터를 직접 건다 (RLS에만 의존하지 않음)', async () => {
    productQueryFilters.length = 0
    await run(SLUG)
    const bySlug = productQueryFilters.find((f) => f.some(([op, c, v]) => op === 'eq' && c === 'slug' && v === SLUG))
    expect(bySlug).toBeTruthy()
    expect(bySlug?.some(([op, c, v]) => op === 'is' && c === 'deleted_at' && v === null)).toBe(true)
  })

  it('DS-3 삭제된 부모의 id로 직접 열면 정상 상품으로 보이지 않는다(404)', async () => {
    const r = await run(DELETED_ID)
    expect(r.status).toBe(404)
  })

  it('DS-4 [회귀] 정상 상품 id로 열면 그 상품이 로드된다', async () => {
    const r = await run(LIVE_ID)
    expect(r.status).toBeUndefined()
    const data = r.data as { product?: { id?: string } } | undefined
    expect(data?.product?.id).toBe(LIVE_ID)
  })
})
