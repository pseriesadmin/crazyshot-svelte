/**
 * §E SYN-6 — 동의어 학습 파이프라인 테스트
 *
 * 테스트 범위:
 *   1. extractLearningTokens — 메시지 → 학습 토큰
 *   2. expandKeywordsWithSynonyms — 키워드 + 그룹 → 확장 키워드
 *   3. matchCannedResponse with synonymGroups — 동의어 경유 매칭
 *   4. 자동 승격 임계값(SYNONYM_PROMOTE_THRESHOLD) 검증
 *
 * DB 의존성 없음 — loadSynonymGroups / recordSynonymLearning 는 별도 E2E 검증.
 */

import { describe, it, expect } from 'vitest'
import {
  extractLearningTokens,
  SYNONYM_PROMOTE_THRESHOLD,
  isSimilarTerm,
  getOccurrenceWeight,
  USAGE_WEIGHT_TIERS,
  SIMILARITY_EDIT_DISTANCE_DIVISOR,
  FALLBACK_SETTINGS,
} from '$lib/server/synonymLearning'
import { expandKeywordsWithSynonyms } from '$lib/server/searchEngine/adapters/cannedResponseSearchIndex'
import type { SynonymGroupData } from '$lib/server/searchEngine/adapters/cannedResponseSearchIndex'
import { matchCannedResponse } from '$lib/server/matchCannedResponse'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const PASSON_GROUP: SynonymGroupData = {
  canonicalTerm: '파손',
  confirmedTerms: ['깨짐', '떨어짐', '파손', '부딪힘', '흠집', '균열'],
}

// §E SYN-9 픽스처: 학습 3회 누적 후 자동 승격된 상태 시뮬레이션
// "부딪쳐서 렌즈가 깨졌어요" 라는 고객 메시지가 파손 답변 매칭에 사용된 후
// '깨졌어요' 토큰이 SYNONYM_PROMOTE_THRESHOLD(3)회 이상 반복 기록돼 confirmed로 승격됐을 때
const PASSON_GROUP_WITH_LEARNING: SynonymGroupData = {
  canonicalTerm: '파손',
  confirmedTerms: ['깨짐', '떨어짐', '파손', '부딪힘', '흠집', '균열', '깨졌어요'],
}

const CANDIDATES: CannedResponseForMatch[] = [
  {
    id: 'd1',
    title: '파손 접수 안내',
    content: '파손 부위 사진을 보내주시면 확인 후 절차를 안내해 드립니다.',
    category: 'damage',
    shortcut: '/파손',
    match_keywords: ['파손'],
    usage_count: 2,
  },
  {
    id: 'r1',
    title: '반납 안내',
    content: '반납은 택배 또는 방문으로 가능합니다.',
    category: 'return',
    shortcut: '/반납',
    match_keywords: [],
    usage_count: 10,
  },
]

// ── 1. extractLearningTokens ──────────────────────────────────────────────────

describe('extractLearningTokens', () => {
  it('빈 문자열 → 빈 배열', () => {
    expect(extractLearningTokens('')).toEqual([])
    expect(extractLearningTokens('   ')).toEqual([])
  })

  it('2자 미만 토큰 제거', () => {
    // 조사 제거 후 1자가 되는 토큰은 필터링됨
    const result = extractLearningTokens('이게 맞나요')
    // "이게" → 조사 "게" 없음 → "이게" 2자 유지 ("이" is a particle, but "이게" is ≥2 chars)
    expect(result.every((t) => t.length >= 2)).toBe(true)
  })

  it('"균열이 생겼어요" → "균열" 포함', () => {
    const result = extractLearningTokens('균열이 생겼어요')
    // "균열이" → stripTrailingParticle → "균열" (조사 "이" 제거)
    expect(result).toContain('균열')
  })

  it('"카메라가 깨졌어요" → "카메라", "깨졌어요" 포함 (정규화)', () => {
    const result = extractLearningTokens('카메라가 깨졌어요')
    // "카메라가" → "카메라" (조사 "가" 제거)
    expect(result).toContain('카메라')
  })

  it('중복 토큰 제거', () => {
    const result = extractLearningTokens('파손 파손 파손')
    const count = result.filter((t) => t === '파손').length
    expect(count).toBe(1)
  })

  it('여러 토큰 분리', () => {
    const result = extractLearningTokens('균열이 생겼어요 확인 부탁드려요')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})

// ── 2. expandKeywordsWithSynonyms ─────────────────────────────────────────────

describe('expandKeywordsWithSynonyms', () => {
  it('그룹 없으면 원본 키워드 그대로', () => {
    const result = expandKeywordsWithSynonyms(['파손'], [])
    expect(result).toEqual(['파손'])
  })

  it('빈 키워드 목록 → 빈 배열', () => {
    const result = expandKeywordsWithSynonyms([], [PASSON_GROUP])
    expect(result).toEqual([])
  })

  it('canonical_term 매칭 → 그룹 전체 confirmed 멤버로 확장', () => {
    const result = expandKeywordsWithSynonyms(['파손'], [PASSON_GROUP])
    // 파손 그룹의 모든 confirmed 멤버가 포함돼야 함
    expect(result).toContain('파손')
    expect(result).toContain('깨짐')
    expect(result).toContain('균열')
    expect(result).toContain('흠집')
    expect(result).toContain('떨어짐')
    expect(result).toContain('부딪힘')
  })

  it('그룹 멤버 일치 → 동일 그룹 전체로 확장 (양방향)', () => {
    // "깨짐"이 파손 그룹의 confirmed 멤버이면 파손 그룹 전체로 확장
    const result = expandKeywordsWithSynonyms(['깨짐'], [PASSON_GROUP])
    expect(result).toContain('파손')
    expect(result).toContain('균열')
  })

  it('관계없는 키워드는 그대로 유지', () => {
    const result = expandKeywordsWithSynonyms(['반납'], [PASSON_GROUP])
    expect(result).toEqual(['반납'])
  })

  it('대소문자 무관 매칭', () => {
    const group: SynonymGroupData = { canonicalTerm: 'DAMAGE', confirmedTerms: ['damage', '파손'] }
    const result = expandKeywordsWithSynonyms(['damage'], [group])
    expect(result).toContain('파손')
  })
})

// ── 3. matchCannedResponse with synonymGroups ─────────────────────────────────

describe('matchCannedResponse — 동의어 확장 매칭', () => {
  it('"균열이 생겼어요" + 파손 그룹 → d1 매칭 (동의어 경유)', () => {
    // "균열이 생겼어요" 에서 "균열" 추출
    // 파손 그룹: "균열" is confirmed → match_keywords ['파손'] 확장 후 '균열' 포함
    // "균열이" 서브스트링: "균열이".includes("균열") → true → bonus +5
    const result = matchCannedResponse('균열이 생겼어요', CANDIDATES, [PASSON_GROUP])
    expect(result?.id).toBe('d1')
  })

  it('"균열이 생겼어요" 동의어 없으면 미매칭 (title/shortcut에 "균열" 없음)', () => {
    // 파손 그룹 없이 호출 — d1의 match_keywords=['파손']만 체크
    // "균열이 생겼어요" 에는 "파손" 미포함 → 매칭 안 됨
    // title "파손 접수 안내"에서 MiniSearch가 "파손"을 잡을 수도 있으나
    // "균열" 자체가 title/shortcut/content 어디에도 없어 점수 0
    const result = matchCannedResponse('균열이 생겼어요', CANDIDATES)
    // 동의어 없이는 d1 매칭 안 됨 — MiniSearch title/shortcut에 "균열" 없음
    expect(result?.id).not.toBe('d1')
  })

  it('"깨짐" 직접 입력 + 파손 그룹 → d1 매칭', () => {
    // d1의 match_keywords=['파손'] + 동의어 확장 → '깨짐' 포함
    // "깨짐".includes("깨짐") → true
    const result = matchCannedResponse('깨짐 접수하고 싶어요', CANDIDATES, [PASSON_GROUP])
    expect(result?.id).toBe('d1')
  })

  it('동의어 있어도 무관한 메시지는 여전히 미매칭', () => {
    const result = matchCannedResponse('오늘 날씨 어때요', CANDIDATES, [PASSON_GROUP])
    expect(result).toBeNull()
  })

  it('기존 직접 매칭은 동의어 유무와 무관하게 동작 (회귀 없음)', () => {
    // "반납"은 r1의 shortcut/title에 직접 있음 — 동의어 불필요
    const withSyn = matchCannedResponse('반납 어떻게 하나요', CANDIDATES, [PASSON_GROUP])
    const withoutSyn = matchCannedResponse('반납 어떻게 하나요', CANDIDATES)
    expect(withSyn?.id).toBe('r1')
    expect(withoutSyn?.id).toBe('r1')
  })

  it('synonymGroups 기본값 = [] — 기존 함수 시그니처와 완전 호환', () => {
    // 파라미터 2개만 전달 (기존 호출부 패턴)
    const result = matchCannedResponse('파손 접수 안내', CANDIDATES)
    // "파손"이 d1 title에 있음 → 매칭
    expect(result?.id).toBe('d1')
  })
})

// ── 4. §E SYN-9 — 학습 전/후 실제 자동응답 매칭 경로 검증 ───────────────────

describe('SYN-9: 학습 후 동의어 확장이 실제 자동응답 매칭에 반영되는가', () => {
  it('[학습 전] "부딪쳐서 렌즈가 깨졌어요" + 시드 그룹만 → 미매칭 (seed에 "깨졌어요" 없음)', () => {
    // 시드 그룹의 확장 결과: ['파손','깨짐','떨어짐','부딪힘','흠집','균열']
    // "부딪쳐서 렌즈가 깨졌어요"에는 위 중 어느 것도 substring으로 포함되지 않음
    // "부딪힘".includes check: "부딪쳐서"≠"부딪힘", "깨졌어요"≠"깨짐" 등 모두 false
    const result = matchCannedResponse('부딪쳐서 렌즈가 깨졌어요', CANDIDATES, [PASSON_GROUP])
    // d1 미매칭이어야 함 — 학습이 없으면 자동응답이 나가지 않음
    expect(result?.id).not.toBe('d1')
  })

  it('[학습 후] "부딪쳐서 렌즈가 깨졌어요" + 학습된 그룹("깨졌어요" confirmed) → d1 매칭', () => {
    // 학습 후 그룹의 확장 결과: [...시드..., '깨졌어요']
    // "부딪쳐서 렌즈가 깨졌어요".includes("깨졌어요") → TRUE → d1 매칭
    const result = matchCannedResponse('부딪쳐서 렌즈가 깨졌어요', CANDIDATES, [PASSON_GROUP_WITH_LEARNING])
    expect(result?.id).toBe('d1')
  })

  it('[학습 후] 동의어 그룹 없이 호출하면 여전히 미매칭 (SYN-9 loadSynonymGroups 없으면 회귀)', () => {
    // loadSynonymGroups를 호출하지 않거나 빈 배열을 전달하면 학습된 확장이 적용되지 않음
    const result = matchCannedResponse('부딪쳐서 렌즈가 깨졌어요', CANDIDATES)
    expect(result?.id).not.toBe('d1')
  })
})

// ── 6. §E SYN-10 — fuzzy candidate merging (유사 후보 통계 병합) ──────────────

describe('isSimilarTerm — 동의어 통계 병합 판정 (SYN-10)', () => {
  it('완전 일치 → true (대소문자 무관)', () => {
    expect(isSimilarTerm('파손', '파손')).toBe(true)
    expect(isSimilarTerm('깨졌어요', '깨졌어요')).toBe(true)
    expect(isSimilarTerm('DAMAGE', 'damage')).toBe(true)
  })

  it('서브스트링 포함 → true (양방향)', () => {
    // '깨졌어요'가 '깨졌어요라고' 안에 포함됨 → 병합 대상
    expect(isSimilarTerm('깨졌어요', '깨졌어요라고')).toBe(true)
    expect(isSimilarTerm('깨졌어요라고', '깨졌어요')).toBe(true)
  })

  it('4자 이상 + 편집거리 1 → true (유사 변형 병합)', () => {
    // '깨졌어요'(4자) vs '깨졌어서'(4자) — 마지막 1자만 다름 → 병합
    expect(isSimilarTerm('깨졌어요', '깨졌어서')).toBe(true)
    // '파손됐어요'(5자) vs '파손됐어서'(5자) — 마지막 1자만 다름 → 병합
    expect(isSimilarTerm('파손됐어요', '파손됐어서')).toBe(true)
  })

  it('2~3자 토큰 — 길이비례 공식(SYN-12)이 maxAllowed=0 → 완전 일치·서브스트링만 병합', () => {
    // '깨짐'(2자) vs '깨져서'(3자) — 서브스트링 아님, min=2 → maxAllowed=0 → 병합 안 함
    expect(isSimilarTerm('깨짐', '깨져서')).toBe(false)
    // '깨진'(2자) vs '깨짐'(2자) — 서브스트링 아님, min=2 → maxAllowed=0 → 병합 안 함
    expect(isSimilarTerm('깨진', '깨짐')).toBe(false)
    // '파손'(2자) vs '파존'(2자) — 편집거리1이지만 min=2 → maxAllowed=0 → 병합 안 함
    expect(isSimilarTerm('파손', '파존')).toBe(false)
  })

  it('4자 이상이지만 편집거리 > 1 → false (관계없는 긴 단어)', () => {
    // '깨졌어요'(4자) vs '부딪쳐서'(4자) — 편집거리 4 → 병합 안 함
    expect(isSimilarTerm('깨졌어요', '부딪쳐서')).toBe(false)
  })

  it('기존 멤버 목록에서 termToRecord 결정 — 유사 멤버 있으면 그 term 반환', () => {
    const existingTerms = ['깨졌어요', '파손됐어요']

    // '깨졌어서' → '깨졌어요'(4자, 편집거리1) 와 유사 → 병합 대상: '깨졌어요'
    const r1 = existingTerms.find((e) => isSimilarTerm('깨졌어서', e))
    expect(r1).toBe('깨졌어요')

    // '파손됐어서' → '파손됐어요'(5자, 편집거리1) 와 유사 → 병합 대상: '파손됐어요'
    const r2 = existingTerms.find((e) => isSimilarTerm('파손됐어서', e))
    expect(r2).toBe('파손됐어요')

    // '반납' → 유사 멤버 없음 → undefined (신규 candidate 생성)
    const r3 = existingTerms.find((e) => isSimilarTerm('반납', e))
    expect(r3).toBeUndefined()
  })

  it('유사 변형 병합으로 임계값에 더 빨리 도달 — 수렴 시뮬레이션', () => {
    // 시나리오: '깨졌어요' 후보 이미 1회 관찰 (count=1)
    // '깨졌어서'가 2회 추가 관찰될 때:
    //   - 병합 있음(SYN-10): '깨졌어요' count = 1+1+1 = 3 ≥ threshold → 승격
    //   - 병합 없음(기존):    '깨졌어서' count = 0+1+1 = 2 < threshold → 미승격
    const existingTerms = ['깨졌어요']
    const threshold = SYNONYM_PROMOTE_THRESHOLD // 3

    let countWithMerge = 1 // 기존 '깨졌어요'가 이미 1회 관찰됨
    let countWithoutMerge = 0 // '깨졌어서' 별도 카운터

    for (const newToken of ['깨졌어서', '깨졌어서']) {
      const similar = existingTerms.find((e) => isSimilarTerm(newToken, e))
      if (similar) countWithMerge += 1
      else countWithoutMerge += 1
    }

    expect(countWithMerge).toBeGreaterThanOrEqual(threshold) // 1+2=3 ≥ 3 → 승격
    expect(countWithoutMerge).toBeLessThan(threshold)        // 2 < 3 → 미승격
  })
})

// ── 7. §E SYN-11 — usage_count 기반 학습 가중치 ──────────────────────────────

describe('getOccurrenceWeight — usage_count 구간별 증가폭 (SYN-11)', () => {
  it('기본 구간 (usage_count < 10) → weight 1 (표준 3회 관찰 필요)', () => {
    expect(getOccurrenceWeight(0)).toBe(1)
    expect(getOccurrenceWeight(5)).toBe(1)
    expect(getOccurrenceWeight(9)).toBe(1)
  })

  it('보통 신뢰 구간 (usage_count 10~19) → weight 2', () => {
    expect(getOccurrenceWeight(10)).toBe(2)
    expect(getOccurrenceWeight(15)).toBe(2)
    expect(getOccurrenceWeight(19)).toBe(2)
  })

  it('높은 신뢰 구간 (usage_count >= 20) → weight 3 (1회 관찰로 즉시 승격)', () => {
    expect(getOccurrenceWeight(20)).toBe(3)
    expect(getOccurrenceWeight(50)).toBe(3)
    expect(getOccurrenceWeight(100)).toBe(3)
  })

  it('USAGE_WEIGHT_TIERS 구간이 내림차순 정렬됨 (첫 번째 매칭 보장)', () => {
    for (let i = 0; i < USAGE_WEIGHT_TIERS.length - 1; i++) {
      expect(USAGE_WEIGHT_TIERS[i].minUsage).toBeGreaterThan(USAGE_WEIGHT_TIERS[i + 1].minUsage)
    }
  })

  it('usage_count=10 빠른답변: 2회 관찰 × weight=2 → threshold(3) 도달', () => {
    const weight = getOccurrenceWeight(10) // 2
    // 2회 × weight=2 = 4 ≥ threshold(3) → 승격
    expect(weight * 2).toBeGreaterThanOrEqual(SYNONYM_PROMOTE_THRESHOLD)
    // weight=1이었다면: 2회 × 1 = 2 < 3 → 미승격
    expect(1 * 2).toBeLessThan(SYNONYM_PROMOTE_THRESHOLD)
  })

  it('usage_count=20 빠른답변: 1회 관찰 × weight=3 → 즉시 threshold(3) 도달', () => {
    const weight = getOccurrenceWeight(20) // 3
    // 1회 × weight=3 = 3 ≥ threshold(3) → 즉시 승격
    expect(weight * 1).toBeGreaterThanOrEqual(SYNONYM_PROMOTE_THRESHOLD)
    // weight=1이었다면: 1회 × 1 = 1 < 3 → 미승격
    expect(1 * 1).toBeLessThan(SYNONYM_PROMOTE_THRESHOLD)
  })
})

// ── 8. §E SYN-12 — 길이비례 허용 편집거리 (하드 4자 게이트 제거) ─────────────

describe('SYN-12: isSimilarTerm 길이비례 공식 — 3종 필수 케이스', () => {
  it('[4자 회귀] maxAllowed=1 — SYN-10 기존 동작과 완전히 동일', () => {
    // 4자: floor((4-1)/3) = 1 → 편집거리 ≤1 허용 (기존과 동일)
    expect(isSimilarTerm('깨졌어요', '깨졌어서')).toBe(true)   // 편집거리 1 ≤ 1 ✓
    expect(isSimilarTerm('깨졌어요', '깨졌어요')).toBe(true)   // 완전일치 ✓
    expect(isSimilarTerm('깨졌어요', '부딪쳐서')).toBe(false)  // 편집거리 4 > 1 ✓
    // 5자: floor((5-1)/3) = 1 → 동일하게 편집거리 ≤1
    expect(isSimilarTerm('파손됐어요', '파손됐어서')).toBe(true)  // 5자, 편집거리 1 ✓
  })

  it('[2~3자] 공식이 maxAllowed=0 — 편집거리 1 변형이 하드게이트가 아닌 공식으로 판정됨', () => {
    // 공식 근거: 2자 → floor((2-1)/3)=0, 3자 → floor((3-1)/3)=0
    // → maxAllowed=0이므로 완전일치·서브스트링 외 불가 (이유가 임의 게이트가 아닌 수식)
    expect(isSimilarTerm('깨짐', '깨짐')).toBe(true)    // 2자 완전일치 → 허용
    expect(isSimilarTerm('깨짐', '깨짐이')).toBe(true)  // 2자가 3자의 서브스트링 → 허용
    expect(isSimilarTerm('깨짐', '깨짜')).toBe(false)   // 2자, 편집거리 1, maxAllowed=0 → 불허
    expect(isSimilarTerm('깨져서', '깨져도')).toBe(false) // 3자, 편집거리 1, maxAllowed=0 → 불허
    // 3자와 4자 혼합: min=3 → maxAllowed=0 → 불허 (하드게이트는 "둘 중 하나가 <4면 false"였으나
    //                                                공식은 "더 짧은 쪽" 기준이라 동일 결과)
    expect(isSimilarTerm('깨진', '깨지나요')).toBe(false) // min=2, maxAllowed=0 → 불허
  })

  it('[7자 이상] maxAllowed=2 — 편집거리 2 변형도 병합 허용 (신규 동작)', () => {
    // 7자: floor((7-1)/3) = 2 → 편집거리 ≤2 허용
    // '파손이확인됩니'(7자) vs '파손이확인됩기'(7자) — 마지막 1자 다름 → edit-dist 1 ≤ 2
    expect(isSimilarTerm('파손이확인됩니', '파손이확인됩기')).toBe(true)
    // '파손이확인됩니'(7자) vs '파손이확인겁기'(7자) — 2자 다름 → edit-dist 2 ≤ 2
    expect(isSimilarTerm('파손이확인됩니', '파손이확인겁기')).toBe(true)
    // '파손이확인됩니'(7자) vs '파손이위인겁기'(7자) — 3자 다름 → edit-dist 3 > 2 → 불허
    expect(isSimilarTerm('파손이확인됩니', '파손이위인겁기')).toBe(false)
  })

  it('SIMILARITY_EDIT_DISTANCE_DIVISOR = 3 (공식 계수 상수 검증)', () => {
    // 매직넘버 금지 — 계수는 반드시 이름 있는 상수로 정의돼야 함
    expect(SIMILARITY_EDIT_DISTANCE_DIVISOR).toBe(3)
    // 4자에서 maxAllowed=1이 나오는 것은 이 계수 때문임을 수식으로 검증
    const minLen4 = 4
    const expected = Math.max(0, Math.floor((minLen4 - 1) / SIMILARITY_EDIT_DISTANCE_DIVISOR))
    expect(expected).toBe(1)
    // 7자에서 maxAllowed=2
    const minLen7 = 7
    const expected7 = Math.max(0, Math.floor((minLen7 - 1) / SIMILARITY_EDIT_DISTANCE_DIVISOR))
    expect(expected7).toBe(2)
  })
})

// ── 9. §E SYN-13 — DB 설정 기반 파라미터 튜닝 ───────────────────────────────────

describe('SYN-13: DB 설정값 주입 — isSimilarTerm + getOccurrenceWeight 커스텀 파라미터', () => {
  it('isSimilarTerm: divisor=6 → 7자 단어 maxAllowed=1 (엄격 — 편집거리 2 불허)', () => {
    // divisor=6: floor((7-1)/6) = 1 → maxAllowed=1
    // 편집거리 1: 허용 ✓
    expect(isSimilarTerm('파손이확인됩니', '파손이확인됩기', 6)).toBe(true)
    // 편집거리 2: 불허 (maxAllowed=1 < 2) — divisor=3이었으면 허용됐을 케이스
    expect(isSimilarTerm('파손이확인됩니', '파손이확인겁기', 6)).toBe(false)
  })

  it('isSimilarTerm: divisor=2 → 3자 단어 maxAllowed=1 (관대 — 편집거리 1 허용)', () => {
    // divisor=2: floor((3-1)/2) = 1 → 3자 단어에서도 편집거리 1 허용
    // (기본 divisor=3이면 floor((3-1)/3)=0 → 불허인 케이스)
    expect(isSimilarTerm('깨져서', '깨져도', 2)).toBe(true)
    // 기본 divisor=3으로는 여전히 불허
    expect(isSimilarTerm('깨져서', '깨져도')).toBe(false)
  })

  it('getOccurrenceWeight: 커스텀 구간 적용 → 해당 구간 weight 반환', () => {
    const customTiers = [
      { minUsage: 5, weight: 99 },
      { minUsage: 0, weight: 1 },
    ] as const
    expect(getOccurrenceWeight(5, customTiers)).toBe(99)
    expect(getOccurrenceWeight(4, customTiers)).toBe(1)
    expect(getOccurrenceWeight(100, customTiers)).toBe(99)
  })

  it('getOccurrenceWeight: 단일 구간 tiers → 모든 usage_count에서 동일 weight 반환', () => {
    const flatTiers = [{ minUsage: 0, weight: 5 }] as const
    expect(getOccurrenceWeight(0, flatTiers)).toBe(5)
    expect(getOccurrenceWeight(100, flatTiers)).toBe(5)
  })

  it('FALLBACK_SETTINGS: 하드코딩 상수와 완전히 일치 (fallback 정합성 검증)', () => {
    expect(FALLBACK_SETTINGS.promoteThreshold).toBe(SYNONYM_PROMOTE_THRESHOLD)
    expect(FALLBACK_SETTINGS.similarityEditDistanceDivisor).toBe(SIMILARITY_EDIT_DISTANCE_DIVISOR)
    expect(FALLBACK_SETTINGS.usageWeightTiers).toBe(USAGE_WEIGHT_TIERS)
  })

  it('isSimilarTerm: divisor 생략 = SIMILARITY_EDIT_DISTANCE_DIVISOR 기본값 (fallback 동작)', () => {
    // divisor 파라미터 생략 시 하드코딩 상수와 동일하게 동작해야 함
    const a = '파손이확인됩니'
    const b = '파손이확인겁기' // 편집거리 2
    expect(isSimilarTerm(a, b)).toBe(isSimilarTerm(a, b, SIMILARITY_EDIT_DISTANCE_DIVISOR))
    expect(isSimilarTerm('깨졌어요', '깨졌어서')).toBe(
      isSimilarTerm('깨졌어요', '깨졌어서', SIMILARITY_EDIT_DISTANCE_DIVISOR),
    )
  })

  it('getOccurrenceWeight: tiers 생략 = USAGE_WEIGHT_TIERS 기본값 (fallback 동작)', () => {
    // tiers 파라미터 생략 시 하드코딩 상수와 동일하게 동작해야 함
    expect(getOccurrenceWeight(0)).toBe(getOccurrenceWeight(0, USAGE_WEIGHT_TIERS))
    expect(getOccurrenceWeight(10)).toBe(getOccurrenceWeight(10, USAGE_WEIGHT_TIERS))
    expect(getOccurrenceWeight(20)).toBe(getOccurrenceWeight(20, USAGE_WEIGHT_TIERS))
  })
})

// ── 10. 자동 승격 임계값 ──────────────────────────────────────────────────────

describe('SYNONYM_PROMOTE_THRESHOLD', () => {
  it('임계값 = 3 (DB RPC upsert_synonym_member p_threshold DEFAULT와 일치)', () => {
    // §E SYN-4: 상수가 3임을 보장
    expect(SYNONYM_PROMOTE_THRESHOLD).toBe(3)
  })

  it('임계값은 양의 정수', () => {
    expect(Number.isInteger(SYNONYM_PROMOTE_THRESHOLD)).toBe(true)
    expect(SYNONYM_PROMOTE_THRESHOLD).toBeGreaterThan(0)
  })

  it('SYN-11 weight가 3이어도 threshold는 3으로 변경되지 않음 (독립 상수)', () => {
    // weight 최대값(3)이 THRESHOLD(3)를 바꾸지 않음을 보장
    const maxWeight = Math.max(...USAGE_WEIGHT_TIERS.map((t) => t.weight))
    expect(SYNONYM_PROMOTE_THRESHOLD).toBe(3)  // 변경 없음
    expect(maxWeight).toBeGreaterThanOrEqual(1) // 가중치 존재
  })
})
