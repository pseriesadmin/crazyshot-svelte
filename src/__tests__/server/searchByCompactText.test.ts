import { describe, it, expect } from 'vitest'
import { compactText, matchParentIdsByCompactText } from '$lib/server/products/searchByCompactText'

const rows = [
  { id: 'a', name: 'Canon EOS R6 Mark II', brand: 'Canon', product_caption: null, keywords: ['R6MarkII', '캐논'] },
  { id: 'b', name: 'Panasonic AG-CX10', brand: 'Panasonic', product_caption: null, keywords: null },
  { id: 'c', name: 'DJI Osmo Action 6', brand: 'DJI', product_caption: null, keywords: ['OsmoAction6'] },
  { id: 'd', name: '삼각대', brand: null, product_caption: null, keywords: [] },
]

describe('공백·하이픈 무시 검색', () => {
  it('정규화: 소문자·공백·하이픈 제거', () => expect(compactText('AG-CX 10')).toBe('agcx10'))
  it('띄어 쓴 검색어가 붙여 쓴 키워드를 찾는다', () => expect(matchParentIdsByCompactText(rows, 'R6 Mark II')).toContain('a'))
  it('붙여 쓴 검색어가 띄어 쓴 상품명을 찾는다', () => expect(matchParentIdsByCompactText(rows, 'r6markii')).toContain('a'))
  it('하이픈 유무를 무시한다', () => expect(matchParentIdsByCompactText(rows, 'AGCX10')).toEqual(['b']))
  it('Osmo Action 6 → OsmoAction6 키워드', () => expect(matchParentIdsByCompactText(rows, 'osmo action 6')).toEqual(['c']))
  it('정규화 3자 미만은 비교하지 않는다', () => expect(matchParentIdsByCompactText(rows, 'a b')).toEqual([]))
  it('무관한 검색어는 없음', () => expect(matchParentIdsByCompactText(rows, 'xyz999')).toEqual([]))
})
