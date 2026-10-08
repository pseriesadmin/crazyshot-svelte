/**
 * synonymExpander.ts — 동의어 확장 순수 함수
 *
 * confirmed 동의어 그룹 목록을 기반으로 입력 쿼리를 확장합니다.
 *
 * 예) 그룹: { canonicalTerm: "소니", confirmedTerms: ["소니", "Sony", "SONY"] }
 *     입력: "소니"
 *     반환: ["Sony", "SONY"]  ← 입력어 자신은 제외
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다.
 * 의존성: 순수 TypeScript (런타임 외부 의존성 없음).
 * 원칙: core/ 격리 원칙 준수 — nlsearch.md §3 "core/ 격리 원칙"
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

/**
 * 동의어 그룹 — loadSynonymGroups()가 반환하는 SynonymGroupData와 동일한 구조.
 * core/ 격리 원칙상 외부 타입을 import하지 않으므로 최소 필요 필드만 재선언.
 */
export interface SynonymGroup {
  /** 그룹의 대표어 (canonical_term) */
  canonicalTerm: string
  /** status='confirmed'인 멤버 term 전체 */
  confirmedTerms: string[]
}

// ── 핵심 순수 함수 ───────────────────────────────────────────────────────────

/**
 * 입력 쿼리가 동의어 그룹의 canonical 또는 confirmed term과 일치하면
 * 같은 그룹의 나머지 confirmed term 배열을 반환합니다.
 *
 * - 대소문자 구분 없이(toLowerCase) 비교합니다.
 * - 입력 쿼리 자신은 반환 목록에 포함하지 않습니다.
 * - 일치하는 그룹이 없으면 빈 배열을 반환합니다.
 * - 여러 그룹에서 일치가 발생하면 전부 합산해 중복 제거 후 반환합니다.
 *
 * @param query 사용자 검색어 (정규화 전 원문)
 * @param groups loadSynonymGroups()로 로드한 confirmed 동의어 그룹 목록
 * @returns 확장 검색어 목록 (빈 배열 = 확장 없음 = 기존 동작 유지)
 *
 * @example
 * const groups = [{ canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony', 'SONY'] }]
 * expandQueryWithConfirmedSynonyms('소니', groups)  // → ['Sony', 'SONY']
 * expandQueryWithConfirmedSynonyms('Sony', groups)  // → ['소니', 'SONY']
 * expandQueryWithConfirmedSynonyms('캐논', groups)  // → []
 */
export function expandQueryWithConfirmedSynonyms(
  query: string,
  groups: SynonymGroup[],
): string[] {
  if (!query || groups.length === 0) return []

  const queryLower = query.toLowerCase()
  const expanded = new Set<string>()

  for (const group of groups) {
    // canonical 또는 confirmedTerms 중 하나가 쿼리와 일치하는지 확인
    const isMatch =
      group.canonicalTerm.toLowerCase() === queryLower ||
      group.confirmedTerms.some((t) => t.toLowerCase() === queryLower)

    if (!isMatch) continue

    // 일치하는 그룹의 나머지 confirmed term 추가 (입력어 자신 제외)
    for (const term of group.confirmedTerms) {
      if (term.toLowerCase() !== queryLower) {
        expanded.add(term)
      }
    }
  }

  return Array.from(expanded)
}

// ── 단어 단위 치환 (2026-10-08) ──────────────────────────────────────────────

/** 단어 단위 변형 기본 상한 — 고객 검색·CMS 제안은 이 값, 크레이지챗 추천은 더 크게 지정 */
export const DEFAULT_MAX_TOKEN_VARIANTS = 3

export interface QueryTokenExpansion {
  /** 검색어 전체가 동의어와 일치해 만든 대체어 — expandQueryWithConfirmedSynonyms(query, groups)와 동일 */
  whole: string[]
  /** 여러 단어 검색어에서 단어 하나만 확정 동의어로 바꾼 변형 검색어(나머지 단어는 그대로) */
  tokenVariants: string[]
}

/**
 * 검색어를 동의어로 확장합니다 — 전체 일치 확장(whole) + 단어 단위 치환 변형(tokenVariants).
 *
 * expandQueryWithConfirmedSynonyms는 "검색어 전체"가 동의어와 정확히 같을 때만 확장하므로
 * "소니 카메라"처럼 여러 단어로 된 검색어는 확장되지 않는다. 이 함수는 단어 하나씩 동의어로 바꾼 변형도 만든다.
 *
 * - 변형은 한 번에 한 단어만 바꾼다(조합 폭증 방지). 나머지 단어는 입력 그대로 유지.
 * - 대소문자 무시로 원문·whole·변형끼리 중복을 제거하고, 변형은 maxVariants개까지만 만든다.
 * - 그룹이 없거나 단어가 하나뿐이거나 일치하는 단어가 없으면 tokenVariants는 빈 배열 → 기존 동작과 동일.
 *
 * @example
 * const groups = [{ canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] }]
 * expandQueryByTokens('소니 카메라', groups) // → { whole: [], tokenVariants: ['Sony 카메라'] }
 * expandQueryByTokens('소니', groups)        // → { whole: ['Sony'], tokenVariants: [] }
 */
export function expandQueryByTokens(
  query: string,
  groups: readonly SynonymGroup[],
  opts: { tokens?: readonly string[]; maxVariants?: number } = {},
): QueryTokenExpansion {
  const mutableGroups = [...groups]
  const whole = expandQueryWithConfirmedSynonyms(query, mutableGroups)
  const max = Math.max(0, Math.floor(opts.maxVariants ?? DEFAULT_MAX_TOKEN_VARIANTS))
  const tokens = (opts.tokens ?? (query ? query.trim().split(/\s+/) : [])).filter((t) => t !== '')
  if (!query || groups.length === 0 || max === 0 || tokens.length < 2) return { whole, tokenVariants: [] }

  const seen = new Set<string>([query.toLowerCase(), ...whole.map((w) => w.toLowerCase())])
  const tokenVariants: string[] = []
  for (const [i, token] of tokens.entries()) {
    if (tokenVariants.length >= max) break
    for (const syn of expandQueryWithConfirmedSynonyms(token, mutableGroups)) {
      if (tokenVariants.length >= max) break
      const variant = tokens.map((t, j) => (j === i ? syn : t)).join(' ').trim()
      const key = variant.toLowerCase()
      if (!variant || seen.has(key)) continue
      seen.add(key)
      tokenVariants.push(variant)
    }
  }
  return { whole, tokenVariants }
}
