import { describe, it, expect } from 'vitest'
import { MAX_WHOLE_SYNONYMS, buildSuggestSearchPlan, interleaveSuggestHits } from '$lib/server/searchEngine/core/suggestSynonymMerge'

// 검색창 자동완성(/api/search/suggest)의 동의어 확장 — 원문 검색 + 동의어 검색을 한 목록으로 섞는 순수 로직 (2026-10-27)

const groups = [
  { canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] },
  { canonicalTerm: '카메라', confirmedTerms: ['카메라', '본체'] },
]

describe('buildSuggestSearchPlan', () => {
  it('동의어가 없으면 원문 한 줄만 — 기존 동작과 동일', () => {
    expect(buildSuggestSearchPlan('캐논', groups)).toEqual([{ term: '캐논', fuzzy: 0.2 }])
    expect(buildSuggestSearchPlan('캐논', [])).toEqual([{ term: '캐논', fuzzy: 0.2 }])
  })

  it('원문은 오타 허용으로, 동의어는 정확 검색(fuzzy 0)으로 — 엉뚱한 상품 혼입 방지', () => {
    expect(buildSuggestSearchPlan('소니', groups)).toEqual([
      { term: '소니', fuzzy: 0.2 },
      { term: 'Sony', fuzzy: 0 },
    ])
  })

  it('여러 단어 검색어는 단어 하나씩 바꾼 변형도 포함한다', () => {
    const plan = buildSuggestSearchPlan('소니 카메라', groups)
    expect(plan[0]).toEqual({ term: '소니 카메라', fuzzy: 0.2 })
    expect(plan.map((p) => p.term)).toContain('Sony 카메라')
    expect(plan.slice(1).every((p) => p.fuzzy === 0)).toBe(true)
  })

  it('전체 일치 동의어가 많아도 확장어는 4개까지만 — 공개 API 요청당 검색 횟수 상한', () => {
    const many = [{ canonicalTerm: '소니', confirmedTerms: ['소니', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] }]
    const plan = buildSuggestSearchPlan('소니', many)
    expect(plan[0]).toEqual({ term: '소니', fuzzy: 0.2 })
    expect(plan).toHaveLength(1 + MAX_WHOLE_SYNONYMS)
    expect(MAX_WHOLE_SYNONYMS).toBe(4)
  })

  it('빈 검색어는 빈 계획', () => {
    expect(buildSuggestSearchPlan('  ', groups)).toEqual([])
  })
})

describe('interleaveSuggestHits', () => {
  it('목록이 하나면 그대로 limit만큼 — 기존 동작과 동일', () => {
    expect(interleaveSuggestHits([['a', 'b', 'c']], 2)).toEqual(['a', 'b'])
  })

  it('여러 목록은 번갈아 섞고 중복은 한 번만 — 동의어 결과도 limit 안에 들어온다', () => {
    expect(interleaveSuggestHits([['a1', 'a2', 'a3', 'a4'], ['b1', 'a2', 'b3']], 5)).toEqual(['a1', 'b1', 'a2', 'a3', 'b3'])
  })

  it('앞 목록이 비어도 뒤 목록 결과를 채운다', () => {
    expect(interleaveSuggestHits([[], ['b1', 'b2']], 8)).toEqual(['b1', 'b2'])
  })

  it('limit 0 이하·빈 입력은 빈 배열', () => {
    expect(interleaveSuggestHits([['a']], 0)).toEqual([])
    expect(interleaveSuggestHits([], 5)).toEqual([])
  })
})
