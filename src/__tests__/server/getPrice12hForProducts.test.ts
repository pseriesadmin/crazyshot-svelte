import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPrice12hForProducts } from '$lib/server/getPrice12hForProducts'

// price_rules 조회 체인(select → eq → eq → is → in)만 흉내내는 최소 mock
function mockSupabase(result: { data: unknown; error: { message: string } | null }) {
  const calls: { eq: [string, unknown][]; is: [string, unknown][]; inArgs?: [string, unknown[]] } = { eq: [], is: [] }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn((c: string, v: unknown) => { calls.eq.push([c, v]); return chain })
  chain.is = vi.fn((c: string, v: unknown) => { calls.is.push([c, v]); return chain })
  chain.in = vi.fn((c: string, v: unknown[]) => { calls.inArgs = [c, v]; return Promise.resolve(result) })
  const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient
  return { client, calls }
}

describe('getPrice12hForProducts — 검색 12h 실값 배치 조회', () => {
  it('활성 12h 규칙만 조회하고 상품별 가격 맵을 만든다', async () => {
    const { client, calls } = mockSupabase({ data: [{ product_id: 'a', price: 95000 }, { product_id: 'b', price: '65000' }], error: null })
    const map = await getPrice12hForProducts(client, ['a', 'b', 'a'])
    expect(map).toEqual({ a: 95000, b: 65000 })
    expect(calls.eq).toContainEqual(['duration_type', '12h'])
    expect(calls.eq).toContainEqual(['is_active', true])
    expect(calls.is).toContainEqual(['deleted_at', null])
    expect(calls.inArgs?.[1]).toEqual(['a', 'b']) // 중복 제거
  })

  it('12h 규칙이 없는 상품은 맵에 키가 없다(70% 계산 폴백 금지)', async () => {
    const { client } = mockSupabase({ data: [{ product_id: 'a', price: 95000 }], error: null })
    const map = await getPrice12hForProducts(client, ['a', 'no-rule'])
    expect(map['no-rule']).toBeUndefined()
  })

  it('빈 목록이면 조회하지 않는다', async () => {
    const { client } = mockSupabase({ data: [], error: null })
    expect(await getPrice12hForProducts(client, [])).toEqual({})
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })

  it('조회 에러면 빈 맵을 돌려주고 throw하지 않는다(fail-soft)', async () => {
    const { client } = mockSupabase({ data: null, error: { message: 'boom' } })
    expect(await getPrice12hForProducts(client, ['a'])).toEqual({})
  })
})
