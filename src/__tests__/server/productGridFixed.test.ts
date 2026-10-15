import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FIXED_GRID_MAX,
  fetchGridRowsWithFixed,
  mergeFixedFirst,
  normalizeFixedProducts,
  pickFixedIdsForCategory,
  resolveCategoryCase,
  resolveGridSort,
} from '$lib/server/products/productGrid'

describe('normalizeFixedProducts', () => {
  it('배열이 아니면 빈 목록', () => {
    for (const raw of [null, undefined, 'x', 3, {}]) expect(normalizeFixedProducts(raw)).toEqual([])
  })

  it('order 오름차순으로 정렬하고 중복·빈 id·잘못된 항목을 제거한다', () => {
    const r = normalizeFixedProducts([
      { id: 'b', order: 2 },
      { id: 'a', order: 0 },
      { id: 'a', order: 5 },
      { id: '  ', order: 1 },
      null,
      { order: 3 },
      { id: 'c', order: 1 },
    ])
    expect(r.map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('order 가 숫자가 아니면 배열 위치를 쓴다', () => {
    const r = normalizeFixedProducts([{ id: 'x', order: 'abc' }, { id: 'y', order: 'def' }])
    expect(r.map((x) => x.id)).toEqual(['x', 'y'])
  })

  it(`최대 ${FIXED_GRID_MAX}개로 자른다`, () => {
    const many = Array.from({ length: FIXED_GRID_MAX + 5 }, (_, i) => ({ id: `p${i}`, order: i }))
    expect(normalizeFixedProducts(many)).toHaveLength(FIXED_GRID_MAX)
  })
})

describe('mergeFixedFirst', () => {
  const row = (id: string) => ({ id })
  it('고정 행을 앞에 두고 일반 행에서 같은 상품을 뺀다', () => {
    const r = mergeFixedFirst([row('b'), row('a')], [row('x'), row('a'), row('y')], 10)
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'x', 'y'])
  })
  it('product_id 키로 온 행도 같은 상품으로 본다', () => {
    const r = mergeFixedFirst([{ id: 'a' }], [{ product_id: 'a' }, { product_id: 'z' }], 10)
    expect(r).toHaveLength(2)
  })
  it('limit 로 자르고, 0 이하면 빈 목록', () => {
    expect(mergeFixedFirst([row('a')], [row('x'), row('y')], 2).map((x) => x.id)).toEqual(['a', 'x'])
    expect(mergeFixedFirst([row('a')], [row('x')], 0)).toEqual([])
    expect(mergeFixedFirst([row('a')], [row('x')], -3)).toEqual([])
  })
})

describe("resolveGridSort('fixed')", () => {
  it("'fixed' 는 DB 정렬 RPC 가 모르는 값이라 기본(조회수순)으로 내려간다", () => {
    expect(resolveGridSort('fixed')).toBe('views')
  })
})

/** rpc 이름별로 결과를 돌려주는 가짜 supabase */
function fakeSupabase(handlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => Promise.resolve(handlers[name](args)))
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

const baseOpts = { category: null as string | null, sort: 'views', limit: 4, seed: 's', userId: null as string | null }

describe('fetchGridRowsWithFixed', () => {
  it('고정 id 가 없으면 일반 조회와 같다(고정 상품 RPC 호출 없음)', async () => {
    const { client, rpc } = fakeSupabase({
      get_products_sorted: () => ({ data: [{ product_id: 'x' }], error: null }),
    })
    const r = await fetchGridRowsWithFixed(client, { ...baseOpts, fixedIds: [] })
    expect(r.data).toEqual([{ product_id: 'x' }])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('고정 상품을 지정 순서대로 앞에 두고 나머지를 이어 붙이며 중복을 뺀다', async () => {
    const { client, rpc } = fakeSupabase({
      get_products_by_ids: () => ({
        // RPC 는 입력 순서를 보장하지 않는다
        data: [{ id: 'b', category: 'CAMERA' }, { id: 'a', category: 'LENS' }],
        error: null,
      }),
      get_products_sorted: () => ({ data: [{ product_id: 'x' }, { product_id: 'a' }, { product_id: 'y' }, { product_id: 'z' }], error: null }),
    })
    const r = await fetchGridRowsWithFixed(client, { ...baseOpts, limit: 4, fixedIds: ['a', 'b'] })
    const ids = (r.data as Record<string, unknown>[]).map((x) => String(x['product_id'] ?? x['id']))
    expect(ids).toEqual(['a', 'b', 'x', 'y'])
    // 일반 조회는 고정 개수만큼 더 가져온다(고정 상품이 중복으로 빠져도 limit 를 채우도록)
    const sortedCall = rpc.mock.calls.find((c) => c[0] === 'get_products_sorted')
    expect((sortedCall?.[1] as Record<string, unknown>).p_limit).toBe(6)
  })

  it('카테고리 필터가 있으면 그 카테고리 고정 상품만 앞에 둔다(대소문자 무시)', async () => {
    const { client } = fakeSupabase({
      get_products_by_ids: () => ({ data: [{ id: 'a', category: 'lens' }, { id: 'b', category: 'CAMERA' }], error: null }),
      get_products_sorted: () => ({ data: [{ product_id: 'x' }], error: null }),
    })
    const r = await fetchGridRowsWithFixed(client, { ...baseOpts, category: 'CAMERA', fixedIds: ['a', 'b'] })
    const ids = (r.data as Record<string, unknown>[]).map((x) => String(x['product_id'] ?? x['id']))
    expect(ids).toEqual(['b', 'x'])
  })

  it('비활성 고정 상품은 제외하고, 고정 상품이 모두 없으면 일반 조회 결과만 돌려준다', async () => {
    const { client } = fakeSupabase({
      get_products_by_ids: () => ({ data: [{ id: 'a', category: 'CAMERA', is_active: false }], error: null }),
      get_products_sorted: () => ({ data: [{ product_id: 'x' }, { product_id: 'y' }], error: null }),
    })
    const r = await fetchGridRowsWithFixed(client, { ...baseOpts, fixedIds: ['a', 'gone'] })
    expect(r.data).toEqual([{ product_id: 'x' }, { product_id: 'y' }])
  })

  it('일반 조회 한도는 RPC 상한(200)을 넘기지 않는다', async () => {
    const { client, rpc } = fakeSupabase({
      get_products_by_ids: () => ({ data: [{ id: 'a', category: 'CAMERA' }], error: null }),
      get_products_sorted: () => ({ data: [], error: null }),
    })
    await fetchGridRowsWithFixed(client, { ...baseOpts, limit: 200, fixedIds: ['a'] })
    const sortedCall = rpc.mock.calls.find((c) => c[0] === 'get_products_sorted')
    expect((sortedCall?.[1] as Record<string, unknown>).p_limit).toBe(200)
  })

  it('누적 limit 로 다시 조회해도 앞부분 순서가 같다(무한스크롤 offset 일관성)', async () => {
    const make = () => fakeSupabase({
      get_products_by_ids: () => ({ data: [{ id: 'a', category: 'C' }, { id: 'b', category: 'C' }], error: null }),
      get_products_sorted: (args) => ({
        data: Array.from({ length: Number(args.p_limit) }, (_, i) => ({ product_id: `r${i}` })),
        error: null,
      }),
    })
    const idsOf = (d: unknown[] | null) => (d as Record<string, unknown>[]).map((x) => String(x['product_id'] ?? x['id']))
    const first = idsOf((await fetchGridRowsWithFixed(make().client, { ...baseOpts, limit: 5, fixedIds: ['a', 'b'] })).data)
    const more = idsOf((await fetchGridRowsWithFixed(make().client, { ...baseOpts, limit: 9, fixedIds: ['a', 'b'] })).data)
    expect(more.slice(0, 5)).toEqual(first)
  })
})

describe('pickFixedIdsForCategory (카테고리별 고정 목록 선택)', () => {
  const item = (id: string, order = 0) => ({ id, order })
  const setting = {
    fixedByCategory: {
      all: [item('a1', 1), item('a0', 0)],
      CAMERA: [item('c1')],
      lens: [item('l1'), item('l2', 1)],
    },
  }

  it('전체(null)는 all 목록을 order 순으로', () => {
    expect(pickFixedIdsForCategory(setting, null)).toEqual(['a0', 'a1'])
  })

  it('카테고리별로 각자 목록을 쓴다(키 대소문자 무시)', () => {
    expect(pickFixedIdsForCategory(setting, 'camera')).toEqual(['c1'])
    expect(pickFixedIdsForCategory(setting, 'LENS')).toEqual(['l1', 'l2'])
  })

  it('목록이 없는 카테고리는 빈 목록(일반 정렬)이고 전체 목록으로 대체하지 않는다', () => {
    expect(pickFixedIdsForCategory(setting, 'drone')).toEqual([])
  })

  it('이전 형식(fixedProducts)은 전체 목록으로만 읽는다', () => {
    const legacy = { fixedProducts: [item('x', 1), item('y', 0)] }
    expect(pickFixedIdsForCategory(legacy, null)).toEqual(['y', 'x'])
    expect(pickFixedIdsForCategory(legacy, 'camera')).toEqual([])
  })

  it('새 형식에 all 이 있으면 이전 형식보다 우선한다', () => {
    const both = { fixedByCategory: { all: [item('n')] }, fixedProducts: [item('old')] }
    expect(pickFixedIdsForCategory(both, null)).toEqual(['n'])
  })

  it('새 형식에 all 이 없고 이전 형식만 있으면 이전 형식을 쓴다', () => {
    const mixed = { fixedByCategory: { camera: [item('c')] }, fixedProducts: [item('old')] }
    expect(pickFixedIdsForCategory(mixed, null)).toEqual(['old'])
    expect(pickFixedIdsForCategory(mixed, 'camera')).toEqual(['c'])
  })

  it('깨진 값(배열·문자열·null)은 빈 목록', () => {
    for (const bad of [null, undefined, [], 'x', 3]) {
      expect(pickFixedIdsForCategory({ fixedByCategory: bad, fixedProducts: bad }, null)).toEqual([])
      expect(pickFixedIdsForCategory({ fixedByCategory: bad }, 'camera')).toEqual([])
    }
  })

  it(`목록마다 최대 ${FIXED_GRID_MAX}개`, () => {
    const many = Array.from({ length: FIXED_GRID_MAX + 4 }, (_, i) => item(`p${i}`, i))
    expect(pickFixedIdsForCategory({ fixedByCategory: { camera: many } }, 'camera')).toHaveLength(FIXED_GRID_MAX)
  })
})

describe('resolveCategoryCase (카테고리 대소문자 구분 없음)', () => {
  const known = ['camera', 'lens', 'used-item']
  it('대소문자가 달라도 등록된 표기로 맞춘다', () => {
    expect(resolveCategoryCase('LENS', known)).toBe('lens')
    expect(resolveCategoryCase('Used-Item', known)).toBe('used-item')
  })
  it('등록된 카테고리에 없으면 그대로, null은 null', () => {
    expect(resolveCategoryCase('drone', known)).toBe('drone')
    expect(resolveCategoryCase(null, known)).toBeNull()
  })
})
