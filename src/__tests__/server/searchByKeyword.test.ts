import { describe, it, expect } from 'vitest'
import { matchParentIdsByKeywords } from '$lib/server/products/searchByKeyword'

describe('matchParentIdsByKeywords', () => {
  const rows = [
    { id: 'a', keywords: ['브이로그', 'Vlog Camera'] },
    { id: 'b', keywords: ['여행'] },
    { id: 'c', keywords: null },
    { id: 'd', keywords: [] },
  ]
  it('부분일치', () => expect(matchParentIdsByKeywords(rows, '브이')).toEqual(['a']))
  it('대소문자 무시', () => expect(matchParentIdsByKeywords(rows, 'vlog')).toEqual(['a']))
  it('키워드 없는 행·빈 검색어는 제외', () => {
    expect(matchParentIdsByKeywords(rows, '없는말')).toEqual([])
    expect(matchParentIdsByKeywords(rows, '  ')).toEqual([])
  })
  it('여러 상품 매칭', () => expect(matchParentIdsByKeywords(rows, '여행')).toEqual(['b']))
})
