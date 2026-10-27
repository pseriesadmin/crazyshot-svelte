/**
 * suggestSynonymMerge.ts — 검색창 자동완성의 동의어 확장 순수 함수 (2026-10-27)
 *
 * /api/search/suggest 가 쓴다. 원문 검색과 동의어 검색을 한 목록으로 섞는 규칙만 담는다.
 * 동의어 검색어는 검색 RPC가 아닌 MiniSearch(메모리)에서만 찾는다 — RPC는 호출마다 search_logs에 쌓여 인기 검색어를 왜곡한다.
 *
 * ⚠️ core/ 격리 원칙: Supabase·$env·SvelteKit 의존 금지. 순수 TypeScript + synonymExpander 만 사용.
 */

import { expandQueryByTokens, type SynonymGroup } from './synonymExpander'

export interface SuggestSearchStep {
  term: string
  /** MiniSearch fuzzy 값 — 원문은 오타 허용, 동의어는 관리자가 확정한 정확한 말이라 0 */
  fuzzy: number
}

const ORIGINAL_FUZZY = 0.2
const SYNONYM_FUZZY = 0

/** 검색어 전체가 동의어와 일치할 때 쓰는 확장어 상한 — 학습으로 멤버가 늘어도 공개 API 요청당 검색 횟수가 1+3(변형)+4로 묶인다 */
export const MAX_WHOLE_SYNONYMS = 4

/** 원문 한 줄 + (전체 일치 동의어, 단어 단위 변형) 줄들. 동의어가 없으면 원문 한 줄뿐 → 기존 동작과 동일 */
export function buildSuggestSearchPlan(query: string, groups: readonly SynonymGroup[]): SuggestSearchStep[] {
  const q = query.trim()
  if (!q) return []
  const { whole, tokenVariants } = expandQueryByTokens(q, groups)
  return [
    { term: q, fuzzy: ORIGINAL_FUZZY },
    ...tokenVariants.map((term) => ({ term, fuzzy: SYNONYM_FUZZY })),
    ...whole.slice(0, MAX_WHOLE_SYNONYMS).map((term) => ({ term, fuzzy: SYNONYM_FUZZY })),
  ]
}

/**
 * 여러 검색 결과 목록을 번갈아(1등끼리 → 2등끼리 …) 섞어 중복 없이 limit개까지 고른다.
 * 앞 목록이 limit을 다 채워 동의어 결과가 밀려나는 것을 막는다. 목록이 하나면 그 목록의 앞 limit개 그대로.
 */
export function interleaveSuggestHits(lists: readonly (readonly string[])[], limit: number): string[] {
  const out: string[] = []
  if (limit <= 0) return out
  const seen = new Set<string>()
  const longest = lists.reduce((m, l) => Math.max(m, l.length), 0)
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of lists) {
      const id = list[i]
      if (id === undefined || seen.has(id)) continue
      seen.add(id)
      out.push(id)
      if (out.length >= limit) break
    }
  }
  return out
}
