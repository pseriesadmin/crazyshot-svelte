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
    expect(page).toContain('/api/search/crazylog?q=${encodeURIComponent(q)}&limit=${CRAZYLOG_LIMIT}')
    expect(page).toContain('const CRAZYLOG_LIMIT = 6')
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

describe('자동완성 로그 분리 · 입력창 채움 · 더보기 (2026-10-06)', () => {
  const page = read('src/routes/products/search/+page.svelte')
  const suggest = read('src/routes/api/search/suggest/+server.ts')
  const section = read('src/lib/components/crazylog/SearchCrazylogSection.svelte')
  const list = read('src/routes/crazylog/list/+page.svelte')

  it('자동완성은 search_products RPC(검색 로그 기록)가 아닌 /api/search/suggest를 호출한다', () => {
    const fn = page.slice(page.indexOf('async function fetchSuggestions'), page.indexOf('/** Enter·검색 아이콘'))
    expect(fn).toContain('/api/search/suggest?q=')
    expect(fn).not.toContain('/api/search/products')
  })

  it('suggest API는 search_products RPC·search_logs를 쓰지 않고 MiniSearch 인덱스만 조회한다', () => {
    expect(suggest).toContain('getProductSearchIndex')
    expect(suggest).not.toContain("rpc('search_products'")
    expect(suggest).not.toContain("from('search_logs')")
    expect(suggest).toContain('if (q.length < 2)')
  })

  it('결과 화면 검색은 기존 /api/search/products(로그·CTR 학습 유지)를 그대로 쓴다', () => {
    expect(page).toContain('/api/search/products?q=${encodeURIComponent(q)}&limit=12')
  })

  it('입력창 표시 문구를 직접 관리해 키워드 칩 클릭·?q= 진입 때도 검색어가 채워진다', () => {
    expect(page).toContain("let inputText        = $state($page.url.searchParams.get('q') ?? '')")
    expect(page).toContain('value={inputText}')
    expect(page).toContain('searchQuery = kw; inputText = kw; doSearch(kw)')
  })

  it('크레이지로그가 조회 한도(6)를 채웠을 때만 더보기 링크(/crazylog/list?q=)를 넘긴다', () => {
    expect(page).toContain('crazylogResults.length >= CRAZYLOG_LIMIT')
    expect(page).toContain('/crazylog/list?q=${encodeURIComponent(submittedQuery)}')
    expect(section).toContain('{#if moreHref}')
  })

  it('크레이지로그 목록은 ?q=로 진입하면 입력창을 채우고 한 번 검색한다', () => {
    expect(list).toContain("$page.url.searchParams.get('q')")
    expect(list).toContain('initialSearchDone')
    expect(list).toContain('triggerSearch(q, activeTab)')
  })
})
