import { describe, it, expect } from 'vitest'
import { MAX_CARD_KEYWORDS, sanitizeCardKeywords, parseCardKeywords, toggleCardKeyword } from '$lib/utils/cardKeywords'

describe('sanitizeCardKeywords — 카드 노출 키워드는 등록된 키워드 안에서만', () => {
  it('등록된 키워드에 없는 값·빈값·중복을 걸러낸다', () => {
    expect(sanitizeCardKeywords(['a', 'x', '', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })
  it('최대 개수를 넘기면 앞에서부터 자른다', () => {
    const kws = ['1', '2', '3', '4', '5']
    expect(sanitizeCardKeywords(kws, kws)).toHaveLength(MAX_CARD_KEYWORDS)
  })
  it('배열이 아닌 입력은 빈 배열', () => {
    expect(sanitizeCardKeywords(null, ['a'])).toEqual([])
    expect(sanitizeCardKeywords('a', ['a'])).toEqual([])
  })
})

describe('parseCardKeywords — DB 값 읽기', () => {
  it('문자열만 남기고 최대 개수로 자른다', () => {
    expect(parseCardKeywords(['a', 1, null, 'b'])).toEqual(['a', 'b'])
    expect(parseCardKeywords(undefined)).toEqual([])
  })
})

describe('toggleCardKeyword', () => {
  it('선택 → 해제', () => {
    expect(toggleCardKeyword(['a', 'b'], 'a')).toEqual({ next: ['b'], limited: false })
  })
  it('해제 → 선택(맨 뒤)', () => {
    expect(toggleCardKeyword(['a'], 'b')).toEqual({ next: ['a', 'b'], limited: false })
  })
  it('최대 개수에서 추가하면 그대로 두고 limited 표시', () => {
    const full = Array.from({ length: MAX_CARD_KEYWORDS }, (_, i) => `k${i}`)
    expect(toggleCardKeyword(full, 'new')).toEqual({ next: full, limited: true })
  })
})
