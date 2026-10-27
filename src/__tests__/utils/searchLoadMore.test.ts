import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SEARCH_FETCH_LIMIT,
  SEARCH_VISIBLE_BATCH,
  extractTotalCount,
  hasMoreAfterPage,
  hasMoreResults,
  formatResultTotal,
  mergeUniqueById,
  needsRemoteFetch,
  nextVisibleCount,
  remoteHasMore,
} from '$lib/utils/searchLoadMore'

// /products/search 검색 결과 "더보기" (2026-10-27) — 한 번에 50개를 받아 12개씩 보여주고, 50개를 다 보여준 뒤에만 다음 페이지를 요청한다.
// (검색 RPC가 호출마다 search_logs에 기록하므로 12개마다 API를 부르면 인기 검색어 집계가 부풀려진다.)

const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `p${from + i}` }))

describe('상수', () => {
  it('화면에는 12개씩, 서버에서는 50개씩(API 최대치)', () => {
    expect(SEARCH_VISIBLE_BATCH).toBe(12)
    expect(SEARCH_FETCH_LIMIT).toBe(50)
  })
})

describe('mergeUniqueById', () => {
  it('이미 있는 id는 건너뛰고 새 항목만 순서대로 뒤에 붙인다', () => {
    const r = mergeUniqueById(rows(1, 3), [{ id: 'p3' }, { id: 'p4' }, { id: 'p5' }])
    expect(r.merged.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(r.added).toBe(2)
  })

  it('응답 안의 중복 id도 한 번만 넣는다', () => {
    const r = mergeUniqueById([], [{ id: 'a' }, { id: 'a' }, { id: 'b' }])
    expect(r.merged.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.added).toBe(2)
  })

  it('전부 중복이면 added 0 — 원본은 그대로', () => {
    const base = rows(1, 2)
    const r = mergeUniqueById(base, rows(1, 2))
    expect(r.added).toBe(0)
    expect(r.merged).toEqual(base)
  })
})

describe('nextVisibleCount', () => {
  it('12개씩 늘리되 불러온 개수를 넘지 않는다', () => {
    expect(nextVisibleCount(12, 50)).toBe(24)
    expect(nextVisibleCount(24, 30)).toBe(30)
    expect(nextVisibleCount(30, 30)).toBe(30)
  })
})

describe('hasMoreResults — 더보기 버튼 노출', () => {
  it('아직 안 보여준 결과가 있으면 노출', () => {
    expect(hasMoreResults(12, 30, false)).toBe(true)
  })
  it('다 보여줬고 서버에 더 없으면 숨김', () => {
    expect(hasMoreResults(30, 30, false)).toBe(false)
    expect(hasMoreResults(0, 0, false)).toBe(false)
  })
  it('다 보여줬어도 서버에 더 있으면 노출', () => {
    expect(hasMoreResults(50, 50, true)).toBe(true)
  })
})

describe('needsRemoteFetch — 다음 페이지 요청 시점', () => {
  it('이미 불러온 결과로 12개를 채울 수 있으면 서버에 묻지 않는다', () => {
    expect(needsRemoteFetch(12, 50, true)).toBe(false)
    expect(needsRemoteFetch(36, 50, true)).toBe(false)
  })
  it('불러온 결과를 넘어서게 되고 서버에 더 있으면 요청한다', () => {
    expect(needsRemoteFetch(48, 50, true)).toBe(true)
    expect(needsRemoteFetch(50, 50, true)).toBe(true)
  })
  it('서버에 더 없으면 요청하지 않는다', () => {
    expect(needsRemoteFetch(24, 30, false)).toBe(false)
  })
})

describe('remoteHasMore — 서버에 다음 페이지가 더 있는지', () => {
  it('꽉 찬 응답이고 새 항목이 있었을 때만 더 있다고 본다', () => {
    expect(remoteHasMore(50, 50)).toBe(true)
    expect(remoteHasMore(49, 49)).toBe(false)
    expect(remoteHasMore(50, 0)).toBe(false)
  })
})

describe('formatResultTotal — 결과 건수 표시', () => {
  it('서버에 더 없으면 받아온 개수가 곧 전체 건수', () => {
    expect(formatResultTotal(39, false)).toBe('39')
    expect(formatResultTotal(0, false)).toBe('0')
  })
  it('서버에 더 있으면 "50+"처럼 더 있음을 표시', () => {
    expect(formatResultTotal(50, true)).toBe('50+')
  })
})

describe('extractTotalCount — 서버가 주는 전체 건수(total_count)', () => {
  it('모든 행에 같은 total_count가 있으면 그 값을 쓴다', () => {
    expect(extractTotalCount([{ total_count: 92 }, { total_count: 92 }])).toBe(92)
  })
  it('숫자 문자열도 정수로 읽는다', () => {
    expect(extractTotalCount([{ total_count: '13' }])).toBe(13)
  })
  it('약한 매칭 폴백 행처럼 total_count가 없는 행이 섞이면 신뢰하지 않는다(null)', () => {
    expect(extractTotalCount([{ total_count: 2 }, {}])).toBeNull()
  })
  it('행마다 값이 다르거나 음수·소수·숫자가 아니면 null', () => {
    expect(extractTotalCount([{ total_count: 5 }, { total_count: 6 }])).toBeNull()
    expect(extractTotalCount([{ total_count: -1 }])).toBeNull()
    expect(extractTotalCount([{ total_count: 1.5 }])).toBeNull()
    expect(extractTotalCount([{ total_count: 'abc' }])).toBeNull()
    expect(extractTotalCount([{ total_count: null }])).toBeNull()
  })
  it('빈 응답은 null', () => {
    expect(extractTotalCount([])).toBeNull()
  })
  it('빈 문자열·공백 문자열은 0으로 오해하지 않고 null (Number("")는 0)', () => {
    expect(extractTotalCount([{ total_count: '' }])).toBeNull()
    expect(extractTotalCount([{ total_count: '   ' }])).toBeNull()
  })
  it('NaN·Infinity는 null', () => {
    expect(extractTotalCount([{ total_count: Number.NaN }])).toBeNull()
    expect(extractTotalCount([{ total_count: Number.POSITIVE_INFINITY }])).toBeNull()
    expect(extractTotalCount([{ total_count: Number.NEGATIVE_INFINITY }])).toBeNull()
  })
  it('boolean·배열·객체·undefined는 null (true를 1로 읽지 않는다)', () => {
    expect(extractTotalCount([{ total_count: true }])).toBeNull()
    expect(extractTotalCount([{ total_count: false }])).toBeNull()
    expect(extractTotalCount([{ total_count: [5] }])).toBeNull()
    expect(extractTotalCount([{ total_count: { n: 5 } }])).toBeNull()
    expect(extractTotalCount([{ total_count: undefined }])).toBeNull()
  })
  it('지수·16진·부호·소수점 표기 문자열은 null — 10진 정수 문자열만 허용', () => {
    for (const bad of ['1e2', '0x10', '+5', '-5', '5.0', '5.', '.5', '1,000', '٣', '5 6']) {
      expect(extractTotalCount([{ total_count: bad }]), bad).toBeNull()
    }
  })
  it('앞뒤 공백이 있는 10진 정수 문자열과 0은 허용', () => {
    expect(extractTotalCount([{ total_count: ' 92 ' }])).toBe(92)
    expect(extractTotalCount([{ total_count: '0' }])).toBe(0)
    expect(extractTotalCount([{ total_count: 0 }])).toBe(0)
  })
})

describe('hasMoreAfterPage — 서버에 다음 페이지가 더 있는지', () => {
  it('전체 건수를 알면 받아온 개수가 그보다 적을 때만 더 있다', () => {
    expect(hasMoreAfterPage({ loaded: 50, total: 92, rawCount: 50, added: 50 })).toBe(true)
    expect(hasMoreAfterPage({ loaded: 92, total: 92, rawCount: 42, added: 42 })).toBe(false)
  })
  it('정확히 50건이면 더 없다(거짓 "50+"가 생기지 않는다)', () => {
    expect(hasMoreAfterPage({ loaded: 50, total: 50, rawCount: 50, added: 50 })).toBe(false)
  })
  it('받아온 개수가 전체 건수를 넘어도(폴백이 덧붙인 경우) 더 없다', () => {
    expect(hasMoreAfterPage({ loaded: 54, total: 52, rawCount: 4, added: 4 })).toBe(false)
  })
  it('새 항목이 하나도 없으면(전부 중복) 전체 건수와 상관없이 끝낸다', () => {
    expect(hasMoreAfterPage({ loaded: 50, total: 92, rawCount: 50, added: 0 })).toBe(false)
  })
  it('전체 건수를 모르면 기존 방식(꽉 찬 응답이고 새 항목이 있을 때)', () => {
    expect(hasMoreAfterPage({ loaded: 50, total: null, rawCount: 50, added: 50 })).toBe(true)
    expect(hasMoreAfterPage({ loaded: 39, total: null, rawCount: 39, added: 39 })).toBe(false)
  })
})

describe('formatResultTotal — 전체 건수를 알 때', () => {
  it('50을 넘어도 실제 전체 건수를 그대로 보여준다(+ 없음)', () => {
    expect(formatResultTotal(50, true, 92)).toBe('92')
    expect(formatResultTotal(50, false, 50)).toBe('50')
  })
  it('받아온 개수가 더 크면 받아온 개수를 보여준다', () => {
    expect(formatResultTotal(54, false, 52)).toBe('54')
  })
  it('전체 건수를 모르면 기존 표기("50+")', () => {
    expect(formatResultTotal(50, true, null)).toBe('50+')
    expect(formatResultTotal(39, false, null)).toBe('39')
  })
})

describe('검색 화면 배선 (소스 고정)', () => {
  const page = readFileSync('src/routes/products/search/+page.svelte', 'utf-8')
  const grid = readFileSync('src/lib/components/products/SearchProductGrid.svelte', 'utf-8')

  it('첫 검색은 50개를 받아 12개만 보여준다', () => {
    expect(page).toContain('limit=${SEARCH_FETCH_LIMIT}')
    expect(page).toContain('visibleCount')
  })

  it('더보기 클릭은 runLoadMore에 맡기고(동작은 searchLoadMoreController.test.ts), 다음 페이지는 page 파라미터로 이어 받는다', () => {
    expect(page).toContain('&page=${pageNo}')
    expect(page).toContain('runLoadMore<SearchProduct>(')
    expect(page).toContain('getSeq: () => searchSeq')
    expect(page).toContain('fetchPage:')
    // 새 검색(doSearch)의 늦은 응답 폐기 가드는 그대로
    expect(page).toMatch(/if \(seq !== searchSeq\) return/)
  })

  it('그리드에 더보기 버튼을 내려주고, 버튼은 하단에서 PC 폭 제한·모바일 100%이다', () => {
    expect(page).toContain('onLoadMore=')
    expect(grid).toContain('class="more-btn"')
    expect(grid).toMatch(/\.more-btn\s*\{[^}]*width:\s*100%/)
    expect(grid).toMatch(/@media \(min-width: 768px\)[\s\S]*\.more-btn\s*\{[^}]*max-width:/)
  })

  it('헤더 건수는 보이는 개수가 아니라 전체 건수(더 있으면 +)를 보여준다', () => {
    expect(page).toContain('formatResultTotal(')
    expect(page).toContain('totalLabel=')
    expect(grid).toContain('{totalLabel ?? products.length}')
  })

  it("버튼 글자는 'more'(2026-10-27 Stephen 지시)이고 버튼 안에는 수량('현재/전체')을 표시하지 않는다", () => {
    const btn = grid.slice(grid.indexOf('class="more-btn"'), grid.indexOf('</button>', grid.indexOf('class="more-btn"')))
    expect(btn).toContain('more')
    expect(btn).not.toContain('products.length')
    expect(btn).not.toContain('totalLabel')
    expect(btn).not.toContain('더보기')
  })

  it('버튼 배경은 옅은 퍼플 토큰(--cs-purple-op10), 글자는 짙은 퍼플 토큰(--cs-purple-dark), 호버는 배경색만 --cs-purple-pale로 바꾼다 — 보더·그림자·하드코딩 hex 없음', () => {
    const css = grid.slice(grid.indexOf('.more-btn {'), grid.indexOf('/* PC — 검색 결과 없음'))
    expect(css).toMatch(/\.more-btn\s*\{[^}]*background:\s*var\(--cs-purple-op10\)/)
    expect(css).toMatch(/\.more-btn\s*\{[^}]*color:\s*var\(--cs-purple-dark\)/)
    expect(css).toMatch(/\.more-btn:hover\s*\{\s*background:\s*var\(--cs-purple-pale\);?\s*\}/)
    expect(css).toMatch(/\.more-btn\s*\{[^}]*border:\s*none/)
    expect(css).not.toMatch(/box-shadow|outline/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })

  it('글자 크기는 PC보다 모바일이 한 단계 작다 — 모바일 --text-m-script-14B(14px), PC(768px+) --text-pc-title-16(16px)', () => {
    const css = grid.slice(grid.indexOf('.more-btn {'), grid.indexOf('/* PC — 검색 결과 없음'))
    const base = css.slice(css.indexOf('.more-btn {'), css.indexOf('}', css.indexOf('.more-btn {')))
    expect(base).toMatch(/font:\s*var\(--text-m-script-14B\)/)
    const pc = css.slice(css.indexOf('@media (min-width: 768px)'))
    expect(pc).toMatch(/\.more-btn\s*\{[^}]*font:\s*var\(--text-pc-title-16\)/)
  })

  it('더보기 버튼은 더 볼 결과가 있을 때만 그린다(없으면 onLoadMore를 내려주지 않고, 그리드는 onLoadMore가 있을 때만 버튼을 그린다)', () => {
    expect(page).toContain('onLoadMore={submittedQuery && showMoreButton ? loadMore : undefined}')
    expect(grid).toMatch(/\{#if onLoadMore\}[\s\S]*class="more-btn"/)
  })

  it('검색 화면은 첫 응답에서 total_count를 읽어 헤더 건수와 더보기 끝 판정에 쓴다', () => {
    expect(page).toContain('extractTotalCount(')
    expect(page).toContain('hasMoreAfterPage(')
    expect(page).toContain('resultTotal')
    expect(page).toContain('formatResultTotal(searchResults.length, hasMoreRemote, resultTotal)')
  })
})
