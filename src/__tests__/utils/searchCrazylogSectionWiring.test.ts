import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatRelativeTimeKo } from '$lib/utils/relativeTimeKo'

/**
 * /products/search 크레이지로그 결과 섹션 연동(2026-10-06) — 화면 파일은 마운트 테스트가 없어 소스 문자열로 핵심 배선만 고정한다.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('검색 화면 — 크레이지로그 결과 배선', () => {
  const page = read('src/routes/products/search/+page.svelte')

  it('검색 실행(doSearch)에서 상품·크레이지로그를 병렬(allSettled)로 조회하고 최대 6건만 요청한다', () => {
    expect(page).toContain('Promise.allSettled([fetchProductResults(q), fetchCrazylogResults(q)])')
    expect(page).toContain('/api/search/crazylog?q=${encodeURIComponent(q)}&limit=6')
  })

  it('자동완성(fetchSuggestions)·추천 상품 로드에서는 크레이지로그를 호출하지 않는다(트래픽 절감)', () => {
    const suggest = page.slice(page.indexOf('async function fetchSuggestions'), page.indexOf('/** Enter·검색 아이콘'))
    expect(suggest).not.toContain('crazylog')
    const recommended = page.slice(page.indexOf('// 추천 상품'), page.indexOf('const pickerOptions'))
    expect(recommended).not.toContain('crazylog')
  })

  it('늦게 도착한 이전 검색 응답은 버리고, 빈 입력 제출은 크레이지로그 결과를 비운다', () => {
    expect(page).toContain('if (seq !== searchSeq) return')
    expect(page).toContain('crazylogResults = []; return')
  })

  it('섹션은 검색 실행 후에만 렌더하고, 상품 0건이면 우상단 라운드를 켠다', () => {
    expect(page).toContain('{#if submittedQuery}')
    expect(page).toContain('topRound={searchResults.length === 0}')
  })

  it('크레이지로그만 있고 상품이 0건이면 상품 그리드의 "검색 결과가 없습니다" 안내를 숨긴다', () => {
    expect(page).toContain('hideEmpty={!!submittedQuery && crazylogResults.length > 0}')
    const grid = read('src/lib/components/products/SearchProductGrid.svelte')
    expect(grid).toContain('{:else if !hideEmpty}')
  })
})

describe('SearchCrazylogSection', () => {
  const section = read('src/lib/components/crazylog/SearchCrazylogSection.svelte')

  it('결과가 없으면 섹션 자체를 렌더하지 않는다', () => {
    expect(section).toContain('{#if posts.length > 0}')
  })

  it('카드는 /crazylog/view/{id}로 이동하고 썸네일이 없으면 기본 이미지를 쓴다', () => {
    expect(section).toContain('href="/crazylog/view/{p.id}"')
    expect(section).toContain("'/crazylog/content-hero.png'")
  })
})

describe('formatRelativeTimeKo', () => {
  const now = new Date('2026-10-06T12:00:00Z').getTime()
  it('구간별 표기', () => {
    expect(formatRelativeTimeKo('2026-10-06T11:59:40Z', now)).toBe('방금 전')
    expect(formatRelativeTimeKo('2026-10-06T11:30:00Z', now)).toBe('30분 전')
    expect(formatRelativeTimeKo('2026-10-06T09:00:00Z', now)).toBe('3시간 전')
    expect(formatRelativeTimeKo('2026-10-03T12:00:00Z', now)).toBe('3일 전')
  })
  it('잘못된 날짜는 빈 문자열', () => {
    expect(formatRelativeTimeKo('not-a-date', now)).toBe('')
  })
})
