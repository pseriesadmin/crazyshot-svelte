// matchCannedResponse.ts — 자동답변 매칭 순수함수 (서버 전용)
// 하이브리드 자동답변 1단계: Claude 의도분류보다 먼저 실행되는 순수 키워드 매칭.
// intent/category 개념 없이 등록된 빠른답변 전체를 대상으로 스코어링한다 — AI 호출·API
// 키 상태와 완전히 무관하게 동작해야 하므로 여기서는 그 어떤 AI 결과값도 참조하지 않는다.
//
// 2026-08-06 스코어링 교체 (하이브리드):
//   - match_keywords: 기존 substring + Levenshtein 방식 유지
//     (한국어 조사결합어 "고장났어요"에서 키워드 "고장" 추출 등 서브스트링 시맨틱 보존)
//   - title / shortcut / content: MiniSearch 역색인 기반 fuzzy/prefix 검색으로 교체
//     (오타 허용 범위 확대, 튜닝 지점 단순화)
//   §E SYN-9 변경: synonymGroups(기본값 [] 있는 옵셔널 파라미터) 추가 — 기존 2-인자
//   호출부는 하위호환 유지. 시그니처: matchCannedResponse(message, candidates, synonymGroups?)

import { buildCannedResponseIndex } from './searchEngine/adapters/cannedResponseSearchIndex'
import type { SynonymGroupData } from './searchEngine/adapters/cannedResponseSearchIndex'
import { expandKeywordsWithSynonyms } from './searchEngine/adapters/cannedResponseSearchIndex'
import { stripTrailingParticle } from './searchEngine/core/koreanTokenizer'

export type { SynonymGroupData }

export interface CannedResponseForMatch {
  id: string
  title: string
  content: string
  category: string | null
  shortcut: string | null
  /** 관리자가 명시 등록한 고객 매칭 전용 키워드 목록 (단축키와 분리, 다중 등록 가능) */
  match_keywords: string[]
  usage_count: number
}

// ── match_keywords 전용: Levenshtein + substring ────────────────────────────
// 한국어는 "고장났어요" 같은 조사결합어에 키워드("고장")가 서브스트링으로 포함되어 있는 경우가
// 많아 MiniSearch 역색인 방식(단어 단위 매칭)으로는 이를 잡지 못한다.
// 따라서 match_keywords는 기존 방식(서브스트링 + 편집거리 1 완화)을 단일 정본으로 유지한다.

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function keywordMatchesMessage(msgLower: string, msgTokens: string[], keyword: string): boolean {
  const kw = keyword.toLowerCase().trim()
  if (!kw) return false
  if (msgLower.includes(kw)) return true
  if (kw.length < 4) return false
  return msgTokens.some((t) => Math.abs(t.length - kw.length) <= 1 && levenshtein(t, kw) <= 1)
}

/**
 * 고객 메시지와 가장 잘 맞는 빠른답변을 반환합니다.
 *
 * 채점 방식 (2026-08-06 하이브리드):
 *   match_keywords: 서브스트링 + 편집거리 1 완화 (건당 +5, 조사결합어 대응)
 *     + 동의어 확장(synonymGroups 제공 시): canonical 키워드 → 그룹 전체 confirmed 멤버로 확장
 *   shortcut / title / content / match_keywords_text: MiniSearch 역색인 fuzzy(0.2) + prefix(true)
 *     → boost: match_keywords_text(5) > shortcut(3) > title(2) > content(1)
 *
 * 최소 채택 기준: 통합 score > 0 (최소 1개 필드에서 매칭 성공 시 채택)
 * 동점 정렬: score 내림차순 → usage_count 내림차순 → title 오름차순
 *
 * @param message      고객 메시지 원문
 * @param candidates   매칭 후보 전체 목록(canned_responses 전체 — 카테고리 필터 없음)
 * @param synonymGroups 동의어 그룹 목록 — loadSynonymGroups()로 사전 로드해서 전달
 *                      (미제공 시 동의어 확장 없이 동작 — 기존 호환 유지)
 * @returns 가장 적합한 빠른답변 또는 null (미매칭)
 */
export function matchCannedResponse(
  message: string,
  candidates: CannedResponseForMatch[],
  synonymGroups: SynonymGroupData[] = [],
): CannedResponseForMatch | null {
  if (candidates.length === 0) return null
  if (!message || !message.trim()) return null

  const msgLower = message.toLowerCase()
  const msgTokens = msgLower
    .split(/[\s,.!?~·/]+/)
    .filter((t) => t.length >= 2)
    .map(stripTrailingParticle)

  // ── 1단계: MiniSearch (title/shortcut/content/match_keywords_text 검색) ────
  // synonymGroups 제공 시 match_keywords_text가 동의어 확장 포함 버전으로 색인됨
  const index = buildCannedResponseIndex(candidates, synonymGroups)
  const miniResults = index.search(message, {
    fuzzy: 0.2,
    prefix: true,
    limit: candidates.length,
  })

  // MiniSearch 결과를 id→score 맵으로 변환 (boost 이미 내장됨)
  const miniScoreMap = new Map(miniResults.map((r) => [r.document.id, r.score]))

  // ── 2단계: match_keywords 서브스트링 체크 (id→bonusScore 맵) ─────────────
  // synonymGroups 제공 시: match_keywords를 동의어 확장 후 체크
  const kwBonusMap = new Map<string, number>()
  for (const item of candidates) {
    const keywords = synonymGroups.length > 0
      ? expandKeywordsWithSynonyms(item.match_keywords ?? [], synonymGroups)
      : (item.match_keywords ?? [])
    let bonus = 0
    for (const kw of keywords) {
      if (keywordMatchesMessage(msgLower, msgTokens, kw)) bonus += 5
    }
    if (bonus > 0) kwBonusMap.set(item.id, bonus)
  }

  // ── 3단계: 통합 스코어 계산 + 정렬 ───────────────────────────────────────
  const scored: { item: CannedResponseForMatch; score: number }[] = []

  for (const item of candidates) {
    const miniScore = miniScoreMap.get(item.id) ?? 0
    const kwBonus = kwBonusMap.get(item.id) ?? 0
    const totalScore = miniScore + kwBonus
    if (totalScore > 0) {
      scored.push({ item, score: totalScore })
    }
  }

  if (scored.length === 0) return null

  // 동점 정렬: score 내림차순 → usage_count 내림차순 → title 오름차순
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.item.usage_count !== a.item.usage_count) {
      return b.item.usage_count - a.item.usage_count
    }
    return a.item.title.localeCompare(b.item.title, 'ko')
  })

  return scored[0].item
}
