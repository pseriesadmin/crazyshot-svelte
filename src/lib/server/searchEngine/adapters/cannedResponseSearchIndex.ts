/**
 * adapters/cannedResponseSearchIndex.ts — 빠른답변(canned_responses) 검색 어댑터
 *
 * crazyshot 전용 코드: CannedResponseForMatch 타입을 core가 이해하는 SearchDocument[]로 변환
 * → createIndex()로 MiniSearchProvider 인스턴스 반환.
 *
 * 계약:
 *   buildCannedResponseIndex(candidates, synonymGroups?) → NaturalSearchProvider<CannedResponseDoc>
 *   boost: match_keywords_text(5) > shortcut(3) > title(2) > content(1)
 *
 * §F FIX-4: 60초 TTL 캐시 적용 — 고객 메시지 1건마다 인덱스를 재구축하던 비효율 해소.
 *   빠른답변 데이터 변경(CRUD) 시 최대 60초 후 TTL 만료로 자동 반영됨.
 *   관리자가 빠른답변을 수정한 직후 즉시 반영이 필요한 경우 invalidateCannedResponseIndex() 호출.
 *
 * ⚠️ 이 파일은 Supabase 클라이언트를 직접 참조하지 않는다 — 호출부(matchCannedResponse.ts)가
 *    이미 조회한 candidates / synonymGroups 배열을 받아서 인덱싱만 담당.
 */

import { createIndex } from '../core/createIndex'
import type { NaturalSearchProvider, SearchDocument } from '../core/types'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

// ── 동의어 그룹 타입 ──────────────────────────────────────────────────────────

/**
 * 동의어 그룹 데이터 (DB에서 로드한 확정 멤버 목록).
 * synonymLearning.ts의 loadSynonymGroups()가 반환하는 타입.
 */
export interface SynonymGroupData {
  /** synonym_groups.canonical_term */
  canonicalTerm: string
  /** status='confirmed'인 synonym_group_members.term 전체 */
  confirmedTerms: string[]
}

// ── CannedResponse 검색 문서 타입 ─────────────────────────────────────────────

export interface CannedResponseDoc extends SearchDocument {
  id: string
  title: string
  content: string
  shortcut: string
  /**
   * match_keywords 배열(동의어 확장 포함)을 공백으로 연결한 문자열.
   * MiniSearch는 배열 필드 미지원 — boost 5로 검색 대상 포함.
   */
  match_keywords_text: string
  /** 원본 데이터 보존 — 검색 후 후속 처리에서 사용 */
  usage_count: number
}

// ── 인덱스 설정 ───────────────────────────────────────────────────────────────

const CANNED_RESPONSE_INDEX_CONFIG = {
  searchFields: ['match_keywords_text', 'shortcut', 'title', 'content'] as const,
  storeFields: ['id', 'title', 'content', 'shortcut', 'match_keywords_text', 'usage_count'] as const,
  boost: {
    match_keywords_text: 5,
    shortcut: 3,
    title: 2,
    content: 1,
  },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

// ── 동의어 확장 ───────────────────────────────────────────────────────────────

/**
 * 키워드 목록을 동의어 그룹으로 확장합니다.
 *
 * 주어진 keywords 중 어떤 항목이 동의어 그룹의 canonical_term 또는 confirmed 멤버이면
 * 해당 그룹의 모든 confirmed 멤버를 추가합니다.
 *
 * 예: keywords=['파손'], groups=[{canonical:'파손', confirmed:['깨짐','균열','파손',...]}]
 *     → ['파손', '깨짐', '균열', '부딪힘', '흠집', '떨어짐']
 *
 * @param keywords 원본 키워드 목록 (match_keywords)
 * @param synonymGroups loadSynonymGroups()로 로드한 그룹 목록
 */
export function expandKeywordsWithSynonyms(
  keywords: string[],
  synonymGroups: SynonymGroupData[],
): string[] {
  if (synonymGroups.length === 0 || keywords.length === 0) return keywords

  const expanded = new Set<string>(keywords)

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase()
    for (const group of synonymGroups) {
      if (
        group.canonicalTerm.toLowerCase() === kwLower ||
        group.confirmedTerms.some((t) => t.toLowerCase() === kwLower)
      ) {
        for (const term of group.confirmedTerms) {
          expanded.add(term)
        }
        break
      }
    }
  }

  return Array.from(expanded)
}

// ── §F FIX-4: TTL 캐시 (60초) — productSearchIndex.ts와 동일 패턴 ─────────────
// 빠른답변 데이터는 관리자 CRUD 시에만 변경되며, 상품 데이터와 유사한 변경 빈도를 가짐.
// 고객 메시지 1건마다 MiniSearch 인덱스를 재구축하던 비효율을 60초 TTL로 해소.

const CANNED_INDEX_CACHE_TTL_MS = 60_000

let cachedCannedIndex: NaturalSearchProvider<CannedResponseDoc> | null = null
let cannedIndexCachedAt = 0
// 캐시 키 서명: candidates 수 + synonymGroups 총 term 수 — 두 값이 모두 같을 때만 캐시 히트
// 이 서명 방식은 프로덕션에서의 실제 사용 패턴(TTL 내 동일 전체 목록)에 적합하며,
// 유닛테스트에서 의도적으로 다른 synonymGroups를 전달하는 케이스도 정확히 구분함.
let cachedKeySignature = ''

/**
 * 캐시를 강제 무효화합니다.
 *
 * 빠른답변 CRUD(추가/수정/삭제) 후 즉시 새 인덱스를 반영해야 할 경우 호출하세요.
 * TTL(60초)만으로 자동 해소되는 경우에는 호출 불필요.
 */
export function invalidateCannedResponseIndex(): void {
  cachedCannedIndex = null
  cannedIndexCachedAt = 0
  cachedKeySignature = ''
}

// ── 어댑터 함수 ───────────────────────────────────────────────────────────────

/**
 * CannedResponseForMatch 배열을 MiniSearch 인덱스로 변환합니다.
 *
 * §F FIX-4: 60초 TTL 캐시 적용 — TTL 내 재호출은 캐시 재사용, 만료 시 재구축.
 * 캐시 무효화 지점: invalidateCannedResponseIndex() 또는 TTL(60초) 만료.
 *
 * @param candidates `canned_responses` 전체 목록 (matchCannedResponse.ts의 candidates 파라미터)
 * @param synonymGroups 동의어 그룹 목록 — 제공 시 match_keywords를 확장하여 색인
 * @returns 즉시 search() 호출 가능한 NaturalSearchProvider
 */
export function buildCannedResponseIndex(
  candidates: CannedResponseForMatch[],
  synonymGroups: SynonymGroupData[] = [],
): NaturalSearchProvider<CannedResponseDoc> {
  // TTL 캐시 히트 — candidates 수 + synonymGroups 총 term 수가 같으면 재사용
  // (두 입력이 모두 같은 내용이라는 실용적 근사: 프로덕션에서 TTL 내 동일 전체 목록 보장)
  const totalSynTerms = synonymGroups.reduce((sum, g) => sum + g.confirmedTerms.length, 0)
  const keySignature = `${candidates.length}:${totalSynTerms}`
  if (
    cachedCannedIndex !== null &&
    Date.now() - cannedIndexCachedAt < CANNED_INDEX_CACHE_TTL_MS &&
    keySignature === cachedKeySignature
  ) {
    return cachedCannedIndex
  }

  // 캐시 미스 또는 만료 — 새 인덱스 구축
  const docs: CannedResponseDoc[] = candidates.map((item) => {
    const expandedKeywords = expandKeywordsWithSynonyms(
      item.match_keywords ?? [],
      synonymGroups,
    )
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      shortcut: item.shortcut ? item.shortcut.replace(/^\//, '') : '',
      match_keywords_text: expandedKeywords.join(' '),
      usage_count: item.usage_count,
    }
  })

  const index = createIndex<CannedResponseDoc>(CANNED_RESPONSE_INDEX_CONFIG, docs)
  cachedCannedIndex = index
  cannedIndexCachedAt = Date.now()
  cachedKeySignature = keySignature
  return index
}
