// 붙여 쓴 검색어 분리 + 한글 브랜드의 영문 발음 후보 (2026-11-17) — "니콘카메라" 미검색 원인 대응
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COMPOUND_HEADS,
  hangulToLatinVariants,
  latinBridgeTerms,
  splitCompoundQuery,
} from '$lib/server/searchEngine/core/compoundQuery'
import { expandQueryForSearch, expandQueryByTokens } from '$lib/server/searchEngine/core/synonymExpander'
import { buildSuggestSearchPlan } from '$lib/server/searchEngine/core/suggestSynonymMerge'
import { buildProductDocs, COMPOUND_HEAD_WORDS, PRODUCT_INDEX_CONFIG } from '$lib/server/searchEngine/adapters/productSearchDocs'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'

describe('splitCompoundQuery — 끝말 기준 붙임말 분리', () => {
  it('니콘카메라 → 니콘 카메라', () => {
    expect(splitCompoundQuery('니콘카메라')).toBe('니콘 카메라')
  })
  it('카메라삼각대 → 카메라 삼각대 / 소니카메라 → 소니 카메라', () => {
    expect(splitCompoundQuery('카메라삼각대')).toBe('카메라 삼각대')
    expect(splitCompoundQuery('소니카메라')).toBe('소니 카메라')
  })
  it('영문+한글 붙임: nikon카메라 → nikon 카메라', () => {
    expect(splitCompoundQuery('nikon카메라')).toBe('nikon 카메라')
  })
  it('나눌 게 없으면 그대로 — 끝말 단독·앞말 1자·일반 단어·이미 띄어 쓴 검색어', () => {
    expect(splitCompoundQuery('카메라')).toBe('카메라')
    expect(splitCompoundQuery('폰카메라')).toBe('폰카메라') // 앞말 1자 → 나누지 않는다
    expect(splitCompoundQuery('니콘')).toBe('니콘')
    expect(splitCompoundQuery('니콘 카메라')).toBe('니콘 카메라')
    expect(splitCompoundQuery('  ')).toBe('')
  })
  it('여러 단어는 단어마다 판단한다', () => {
    expect(splitCompoundQuery('니콘카메라 대여')).toBe('니콘 카메라 대여')
  })
  it('가장 긴 끝말을 먼저 본다(액션캠 vs 캠코더 등)', () => {
    expect(splitCompoundQuery('고프로액션캠')).toBe('고프로 액션캠')
  })
  it('상품 쪽 붙임말 사전과 같은 정본을 쓴다', () => {
    expect(COMPOUND_HEAD_WORDS).toBe(DEFAULT_COMPOUND_HEADS)
  })
})

describe('hangulToLatinVariants — 한글 → 영문 발음 후보', () => {
  it('니콘 → nikon, nicon', () => {
    expect(hangulToLatinVariants('니콘')).toEqual(['nikon', 'nicon'])
  })
  it('캐논 → canon 포함 / 시그마 → sigma 포함 / 로데 → rode', () => {
    expect(hangulToLatinVariants('캐논')).toContain('canon')
    expect(hangulToLatinVariants('시그마')).toContain('sigma')
    expect(hangulToLatinVariants('로데')).toContain('rode')
  })
  it('한글이 아니거나 너무 짧거나 긴 말은 후보 없음', () => {
    expect(hangulToLatinVariants('Nikon')).toEqual([])
    expect(hangulToLatinVariants('가')).toEqual([])
    expect(hangulToLatinVariants('가나다라마바사아자')).toEqual([])
    expect(hangulToLatinVariants('ㅅㄴ')).toEqual([])
  })
})

describe('latinBridgeTerms', () => {
  it('끝말·요청어는 건너뛴다', () => {
    expect(latinBridgeTerms('니콘 카메라')).toEqual(['nikon', 'nicon'])
    expect(latinBridgeTerms('카메라 추천')).toEqual([])
  })
  it('후보 개수에 상한이 있다', () => {
    expect(latinBridgeTerms('니콘 캐논 시그마 로데 소니').length).toBeLessThanOrEqual(4)
  })
})

describe('expandQueryForSearch — 기존 확장 + 붙임말 + 영문 후보', () => {
  const groups = [{ canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] }]
  it('니콘카메라: 나눈 검색어가 변형 맨 앞, 영문 후보가 따로 나온다', () => {
    const r = expandQueryForSearch('니콘카메라', [])
    expect(r.normalized).toBe('니콘 카메라')
    expect(r.tokenVariants[0]).toBe('니콘 카메라')
    expect(r.bridgeTerms).toEqual(['nikon', 'nicon'])
  })
  it('나눈 뒤에도 확정 동의어를 적용한다(소니카메라 → Sony 카메라)', () => {
    const r = expandQueryForSearch('소니카메라', groups)
    expect(r.tokenVariants).toContain('소니 카메라')
    expect(r.tokenVariants).toContain('Sony 카메라')
  })
  it('붙임말이 아니면 기존 expandQueryByTokens와 whole·tokenVariants가 같다', () => {
    for (const q of ['소니 카메라', '소니', 'Canon', '후지 카메라']) {
      const a = expandQueryForSearch(q, groups)
      const b = expandQueryByTokens(q, groups)
      expect({ whole: a.whole, tokenVariants: a.tokenVariants }).toEqual(b)
    }
  })
  it('빈 검색어는 전부 비어 있다', () => {
    expect(expandQueryForSearch('  ', groups)).toEqual({ whole: [], tokenVariants: [], normalized: '', bridgeTerms: [] })
  })
  it('opts.tokens를 직접 준 호출은 분리·영문 후보를 만들지 않는다(크레이지챗 호환)', () => {
    const r = expandQueryForSearch('니콘카메라', [], { tokens: ['니콘카메라'] })
    expect(r.normalized).toBe('니콘카메라')
    expect(r.bridgeTerms).toEqual([])
  })
})

describe('buildSuggestSearchPlan — 자동완성 계획', () => {
  it('기본 호출은 기존과 같다(영문 후보·분리 없음)', () => {
    expect(buildSuggestSearchPlan('니콘카메라', [])).toEqual([{ term: '니콘카메라', fuzzy: 0.2, prefix: true }])
  })
  it('compound 옵션: 분리·영문 후보는 정확 일치(fuzzy 0) 줄로 덧붙는다', () => {
    const plan = buildSuggestSearchPlan('니콘카메라', [], { compound: true })
    expect(plan[0]).toEqual({ term: '니콘카메라', fuzzy: 0.2, prefix: true })
    expect(plan).toContainEqual({ term: '니콘 카메라', fuzzy: 0, prefix: true })
    expect(plan).toContainEqual({ term: 'nikon', fuzzy: 0, prefix: true })
  })
  it('4자 미만 영문 후보("pro")는 접두 일치를 끈다 — Profoto·ProRes 등이 끼어드는 것 방지', () => {
    const plan = buildSuggestSearchPlan('프로', [], { compound: true })
    const pro = plan.find((p) => p.term === 'pro')
    expect(pro).toEqual({ term: 'pro', fuzzy: 0, prefix: false })
    // 원문 줄은 그대로 접두 허용
    expect(plan[0]).toEqual({ term: '프로', fuzzy: 0.2, prefix: true })
  })
  it('4자 이상 영문 후보는 접두 일치를 유지한다', () => {
    const plan = buildSuggestSearchPlan('소니', [], { compound: true })
    expect(plan.find((p) => p.term === 'soni')).toEqual({ term: 'soni', fuzzy: 0, prefix: true })
  })
})

describe('실제 인덱스 설정으로 검색 — "니콘카메라"가 Nikon 상품을 찾는다', () => {
  const rows = [
    { id: 'nikon', name: 'Nikon Coolpix s01', brand: 'Nikon', category: 'camera', keywords: ['NIKON', '쿨픽스', '디지털카메라'] },
    { id: 'sony', name: 'Sony A7M4', brand: 'Sony', category: 'camera', keywords: ['미러리스', '풀프레임'] },
    { id: 'lens', name: 'Canon RF 24-70', brand: 'Canon', category: 'lens', keywords: ['표준줌'] },
  ]
  const labels = new Map([['camera', ['카메라']], ['lens', ['렌즈']]])
  const docs = buildProductDocs(rows, { categoryLabels: labels })
  const index = createIndex(PRODUCT_INDEX_CONFIG as never, docs)

  it('원문 "니콘카메라"는 한 덩어리라 아무것도 못 찾는다(기존 한계 재현)', () => {
    expect(index.search('니콘카메라', { fuzzy: 0.2, prefix: true, limit: 10 })).toEqual([])
  })
  it('영문 후보 "nikon"으로는 Nikon 상품이 1위', () => {
    const ids = index.search('nikon', { fuzzy: 0, prefix: true, limit: 10 }).map((r) => r.document.id)
    expect(ids[0]).toBe('nikon')
  })
  it('분리한 "니콘 카메라"는 카메라 분류 상품을 찾는다(니콘이 한글로 색인돼 있지 않아도 카메라는 보인다)', () => {
    const ids = index.search('니콘 카메라', { fuzzy: 0.2, prefix: true, limit: 10 }).map((r) => r.document.id)
    expect(ids).toContain('nikon')
    expect(ids).toContain('sony')
  })
})
