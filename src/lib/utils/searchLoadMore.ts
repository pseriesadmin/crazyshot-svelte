/**
 * searchLoadMore.ts — /products/search 검색 결과 "더보기" 순수 로직 (2026-10-27)
 *
 * 한 번에 SEARCH_FETCH_LIMIT(50, 검색 API 최대치)개를 받아 SEARCH_VISIBLE_BATCH(12)개씩 보여주고,
 * 받아둔 50개를 다 보여준 뒤에만 다음 페이지를 요청한다.
 * 이유: 검색 RPC(search_products)가 호출마다 search_logs에 기록하므로 12개마다 API를 부르면 같은 검색이 여러 번 집계돼 인기 검색어가 부풀려진다.
 */

/** 화면에 한 번에 더 보여주는 개수 */
export const SEARCH_VISIBLE_BATCH = 12
/** 검색 API 한 번에 받아오는 개수(API 상한 50) */
export const SEARCH_FETCH_LIMIT = 50

/** 이미 있는 id는 건너뛰고 새 항목만 순서대로 뒤에 붙인다(약한 매칭 폴백이 앞 페이지 결과를 다시 줄 수 있어 필요) */
export function mergeUniqueById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): { merged: T[]; added: number } {
  const seen = new Set(existing.map((x) => x.id))
  const merged = [...existing]
  let added = 0
  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
    added++
  }
  return { merged, added }
}

/** 더보기를 누르면 보이는 개수 — 불러온 개수를 넘지 않는다 */
export function nextVisibleCount(visible: number, loaded: number, batch: number = SEARCH_VISIBLE_BATCH): number {
  return Math.min(visible + batch, loaded)
}

/** 더보기 버튼 노출 — 안 보여준 결과가 남았거나 서버에 다음 페이지가 더 있을 때 */
export function hasMoreResults(visible: number, loaded: number, hasMoreRemote: boolean): boolean {
  return visible < loaded || hasMoreRemote
}

/** 12개를 더 채우려면 받아둔 결과가 모자라고 서버에 더 있을 때만 다음 페이지를 요청한다 */
export function needsRemoteFetch(visible: number, loaded: number, hasMoreRemote: boolean, batch: number = SEARCH_VISIBLE_BATCH): boolean {
  return hasMoreRemote && visible + batch > loaded
}

/** 서버에 다음 페이지가 더 있는지 — 꽉 찬 응답이고 새 항목이 있었을 때만(폴백이 같은 결과를 반복해 주는 경우 종료) */
export function remoteHasMore(rawCount: number, added: number, fetchLimit: number = SEARCH_FETCH_LIMIT): boolean {
  return rawCount >= fetchLimit && added > 0
}

/** 결과 건수 표시 — 서버가 전체 건수(total)를 줬으면 그 값(받아온 개수가 더 크면 받아온 개수), 모르면 서버에 더 없을 때 받아온 개수·더 있으면 "50+" */
export function formatResultTotal(loaded: number, hasMoreRemote: boolean, total: number | null = null): string {
  if (total !== null) return String(Math.max(total, loaded))
  return hasMoreRemote ? `${loaded}+` : String(loaded)
}

/**
 * 검색 응답 행의 전체 건수(total_count) — 검색 RPC가 LIMIT 적용 전 전체 매칭 수를 모든 행에 같은 값으로 싣는다.
 * 약한 매칭 폴백 행처럼 값이 없는 행이 섞였거나 값이 서로 다르면 신뢰하지 않고 null.
 */
export function extractTotalCount(rows: readonly Record<string, unknown>[]): number | null {
  if (rows.length === 0) return null
  let total: number | null = null
  for (const row of rows) {
    const raw = row['total_count']
    // 문자열은 앞뒤 공백을 뺀 10진 정수 표기(숫자만)일 때만 읽는다 — Number()는 '', '1e2', '0x10' 같은 값도 숫자로 바꾸므로 쓰기 전에 형식을 확인한다
    const n = typeof raw === 'string' ? (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN) : raw
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null
    if (total !== null && n !== total) return null
    total = n
  }
  return total
}

/** 한 페이지를 받은 뒤 서버에 다음 페이지가 더 있는지 — 전체 건수를 알면 "받아온 개수 < 전체 건수", 모르면 기존 방식(remoteHasMore). 새 항목이 없으면(전부 중복) 끝 */
export function hasMoreAfterPage(args: { loaded: number; total: number | null; rawCount: number; added: number }): boolean {
  if (args.added <= 0) return false
  if (args.total !== null) return args.loaded < args.total
  return remoteHasMore(args.rawCount, args.added)
}

// ── 더보기 클릭 처리 ─────────────────────────────────────────────────────────
// 화면(+page.svelte)의 $state와 분리해 동작을 테스트할 수 있게 한 순수 함수 — 상태 읽기·쓰기·서버 요청은 io로 주입한다.

export interface LoadMoreState<T extends { id: string }> {
  /** 마지막으로 제출된 검색어 */
  query: string
  /** 서버에서 받아둔 결과(화면에는 visibleCount개만 보여준다) */
  results: T[]
  visibleCount: number
  /** 마지막으로 받은 검색 API 페이지 번호 */
  resultsPage: number
  /** 서버가 알려준 전체 건수(total_count) — 모르면 null */
  total: number | null
  hasMoreRemote: boolean
  isLoadingMore: boolean
  /** 새 검색이 진행 중인지 */
  isSearching: boolean
}

export interface LoadMoreIo<T extends { id: string }> {
  /** 현재 검색 요청 번호 — 요청 중 새 검색이 시작되면 값이 바뀐다 */
  getSeq: () => number
  read: () => LoadMoreState<T>
  write: (patch: Partial<LoadMoreState<T>>) => void
  /** 검색 API 한 페이지 — items는 화면 카드로 변환된 항목, rawCount는 서버가 준 행 수, total은 응답의 전체 건수(없으면 생략·null) */
  fetchPage: (query: string, page: number) => Promise<{ items: T[]; rawCount: number; total?: number | null }>
  /** 요청 실패 안내(토스트 등) */
  onError: () => void
}

/**
 * 더보기 — 받아둔 결과에서 12개를 더 보여주고, 모자라면 다음 페이지를 이어 받는다.
 * - 새 검색이 진행 중이거나 이미 요청 중이면 무시(연타·불필요한 검색 기록 방지)
 * - 요청 중 새 검색이 시작되면(seq 변경) 응답을 버리고 상태를 건드리지 않는다
 * - 요청이 실패하면 오류를 알리고, 이미 받아둔 항목은 12개 한도 안에서 보여준다(다시 누르면 재시도)
 */
export async function runLoadMore<T extends { id: string }>(io: LoadMoreIo<T>): Promise<void> {
  const s = io.read()
  if (s.isLoadingMore || s.isSearching || !s.query) return

  if (!needsRemoteFetch(s.visibleCount, s.results.length, s.hasMoreRemote)) {
    io.write({ visibleCount: nextVisibleCount(s.visibleCount, s.results.length) })
    return
  }

  const seq = io.getSeq()
  io.write({ isLoadingMore: true })
  try {
    const { items, rawCount, total: pageTotal } = await io.fetchPage(s.query, s.resultsPage + 1)
    if (seq !== io.getSeq()) return  // 더 최신 검색이 시작됨 — 이 응답은 버린다
    const cur = io.read()
    const { merged, added } = mergeUniqueById(cur.results, items)
    const total = pageTotal ?? cur.total  // 이 페이지에 전체 건수가 없으면(폴백이 섞임) 앞서 알던 값을 유지
    io.write({
      results: merged,
      resultsPage: cur.resultsPage + 1,
      total,
      hasMoreRemote: hasMoreAfterPage({ loaded: merged.length, total, rawCount, added }),
      visibleCount: nextVisibleCount(cur.visibleCount, merged.length),
    })
  } catch {
    if (seq !== io.getSeq()) return
    io.onError()
    const cur = io.read()
    io.write({ visibleCount: nextVisibleCount(cur.visibleCount, cur.results.length) })
  } finally {
    if (seq === io.getSeq()) io.write({ isLoadingMore: false })
  }
}

