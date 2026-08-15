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
