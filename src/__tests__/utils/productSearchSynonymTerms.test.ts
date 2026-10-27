import { describe, it, expect } from 'vitest'
import { productSearchOrFilterForTerms, productSearchOrFilter } from '$lib/utils/similarNameSuggest'
import { rankProductsByRelevance } from '$lib/utils/productSearchRanking'

describe('동의어 변환어 검색 필터', () => {
  it('원 검색어 필터가 먼저, 변환어 필터가 뒤에 합쳐진다(중복 제거)', () => {
    const f = productSearchOrFilterForTerms(['소니', 'Sony', '소니', ' '])
    expect(f).toBe(`${productSearchOrFilter('소니')},${productSearchOrFilter('Sony')}`)
  })
})

describe('동의어 변환어 랭킹', () => {
  const row = (id: string, name: string) => ({ id, name, brand: null, description: null, product_caption: null })
  it('변환어로만 맞은 상품도 결과에 남고, 같은 등급이면 원 검색어 일치가 앞선다', () => {
    const out = rankProductsByRelevance([row('en', 'Sony A7'), row('kr', '소니 A7')], '소니', null, ['Sony'])
    expect(out.map((r) => r.id)).toEqual(['kr', 'en'])
  })
  it('변환어가 없으면 기존 동작과 같다', () => {
    const out = rankProductsByRelevance([row('b', '캐논 A'), row('a', '소니 A')], '소니')
    expect(out[0].id).toBe('a')
  })
})
