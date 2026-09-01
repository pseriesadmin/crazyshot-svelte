import { describe, it, expect, vi } from 'vitest'

/**
 * getPriceMinForProducts — price_rules(24h) 배치 조회 헬퍼 단위 테스트
 *
 * 배경: 검색결과(/products/search) 가격이 전부 0원으로 표시되던 CRITICAL 버그(2026-09-01
 * 실서버 전역 테스트로 발견) — search_products RPC가 폐기된 레거시 컬럼(base_price_daily,
 * 항상 0)을 참조했고(Migration #410으로 수정), MiniSearch 자연어 폴백(natural_fallback)
 * 결과는 애초에 price_min 필드 자체가 없었다. 이 헬퍼는 후자를 보강한다.
 */

const { getPriceMinForProducts } = await import('$lib/server/getPriceMinForProducts')

function makeSupabase(rows: { product_id: string; price: number }[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    })),
  }
}

describe('getPriceMinForProducts', () => {
  it('EC-1: productIds가 비어있으면 쿼리 없이 빈 객체 반환', async () => {
    const supabase = makeSupabase([])
    const result = await getPriceMinForProducts(supabase as never, [])
    expect(result).toEqual({})
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('EC-2: price_rules(24h) 결과를 product_id 기준 맵으로 변환', async () => {
    const supabase = makeSupabase([
      { product_id: 'p1', price: 20000 },
      { product_id: 'p2', price: 35000 },
    ])
    const result = await getPriceMinForProducts(supabase as never, ['p1', 'p2', 'p3'])
    expect(result).toEqual({ p1: 20000, p2: 35000 })
    // p3는 price_rules에 없으므로 맵에 없음(호출부가 null 처리)
    expect(result['p3']).toBeUndefined()
  })

  it('EC-3: duration_type 24h로만 필터링', async () => {
    const supabase = makeSupabase([{ product_id: 'p1', price: 20000 }])
    await getPriceMinForProducts(supabase as never, ['p1'])
    const fromCall = supabase.from.mock.results[0].value
    expect(fromCall.eq).toHaveBeenCalledWith('duration_type', '24h')
  })
})
