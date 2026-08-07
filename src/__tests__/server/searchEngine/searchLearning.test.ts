/**
 * searchLearning.test.ts — §J-2·J-3 학습 기반 키워드 승격 단위 테스트
 *
 * 검증 범위:
 *   J-2: promote_threshold 기준으로 학습된 검색어를 keywords_text에 병합하는 로직
 *   J-2: extractJsonbKeyValues — components·specifications JSONB → 텍스트 변환
 *   J-3: 임계값 초과/미만 분기, 다중 상품 독립성, 빈 데이터 안전성 검증
 *
 * DB 의존성 없음 — 순수 TS 로직으로 재현 (productSearchLogic.test.ts 패턴 동일)
 * 실제 DB 검증: Stage 수동 확인 (하단 스테이지 검증 가이드 참조)
 *
 * stage 수동 확인 절차:
 *   1. 로컬 dev 서버에서 상품을 검색해 "소니"로 검색 → 소니 카메라를 클릭
 *   2. Supabase Table Editor > product_search_stats 에서 해당 product_id의
 *      click_count가 증가했는지 확인 (0 → 1)
 *   3. search_learning_settings.promote_threshold를 1로 낮춰 (UPDATE SET promote_threshold=1)
 *      invalidateProductSearchCache() 호출 또는 dev 서버 재시작 후 검색 인덱스 재구축
 *   4. /api/search/products?q=소니 엔드포인트 응답에서 학습 상품이 앞으로 왔는지 확인
 *   5. promote_threshold를 원래 3으로 복구
 */

import { describe, it, expect } from 'vitest'

// ── J-2: keyword 병합 로직 재현 ───────────────────────────────────────────────
// productSearchIndex.ts의 getProductSearchIndex()에서 학습어 병합 부분을 순수 함수로 추출

interface MockStatsRow {
  product_id: string
  search_term: string
  click_count: number
}

/**
 * product_search_stats 행들 중 임계값 이상 클릭된 항목만 골라
 * product_id → search_term[] 맵을 반환 (DB 조회 로직 재현)
 */
function buildLearnedTermsMap(
  statsRows: MockStatsRow[],
  promoteThreshold: number,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of statsRows) {
    if (row.click_count < promoteThreshold) continue  // 임계값 미만 제외
    const existing = map.get(row.product_id) ?? []
    existing.push(row.search_term)
    map.set(row.product_id, existing)
  }
  return map
}

/**
 * 인덱스 빌드 시 keywords_text에 학습어를 병합하는 로직 재현
 * (productSearchIndex.ts getProductSearchIndex() → docs 생성 부분)
 */
function mergeLearnedKeywords(
  baseKeywords: string[],
  productId: string,
  learnedTerms: Map<string, string[]>,
): string {
  const base = baseKeywords.join(' ')
  const learned = learnedTerms.get(productId) ?? []
  return [base, ...learned].filter(Boolean).join(' ')
}

// ── J-2: extractJsonbKeyValues 재현 ──────────────────────────────────────────
// components·specifications JSONB({"배터리":"1개", "충전케이블":"1개"}) → 텍스트

function extractJsonbKeyValues(jsonb: unknown): string {
  if (!jsonb || typeof jsonb !== 'object' || Array.isArray(jsonb)) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(jsonb as Record<string, unknown>)) {
    if (key) parts.push(key)
    if (value !== null && value !== undefined) parts.push(String(value))
  }
  return parts.join(' ').trim()
}

// ── 테스트 데이터 ─────────────────────────────────────────────────────────────

const PRODUCT_A = 'uuid-product-sony-a7iv'
const PRODUCT_B = 'uuid-product-canon-r6'
const PRODUCT_C = 'uuid-product-dji-gimbal'

const MOCK_STATS: MockStatsRow[] = [
  // PRODUCT_A: '소니 카메라' 5번 클릭 (임계값 3 초과 → 승격 대상)
  { product_id: PRODUCT_A, search_term: '소니 카메라', click_count: 5 },
  // PRODUCT_A: 'a7iv' 3번 클릭 (임계값 3 = 정확히 임계값 → 승격 대상)
  { product_id: PRODUCT_A, search_term: 'a7iv', click_count: 3 },
  // PRODUCT_A: '미러리스' 2번 클릭 (임계값 3 미만 → 승격 제외)
  { product_id: PRODUCT_A, search_term: '미러리스', click_count: 2 },
  // PRODUCT_B: '캐논' 1번 클릭 (임계값 3 미만 → 승격 제외)
  { product_id: PRODUCT_B, search_term: '캐논', click_count: 1 },
  // PRODUCT_C: '짐벌' 10번 클릭 (임계값 초과 → 승격)
  { product_id: PRODUCT_C, search_term: '짐벌', click_count: 10 },
  // PRODUCT_C: 'DJI' 4번 클릭 (임계값 초과 → 승격)
  { product_id: PRODUCT_C, search_term: 'DJI', click_count: 4 },
]

const PROMOTE_THRESHOLD = 3

// ── 테스트 실행 ──────────────────────────────────────────────────────────────

describe('J-2: promote_threshold 기반 학습어 필터링', () => {
  it('click_count >= promoteThreshold인 항목만 맵에 포함', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)

    // PRODUCT_A: '소니 카메라'(5), 'a7iv'(3) → 2개 승격
    expect(map.get(PRODUCT_A)).toEqual(expect.arrayContaining(['소니 카메라', 'a7iv']))
    expect(map.get(PRODUCT_A)).toHaveLength(2)

    // '미러리스'(2)는 임계값 미만 → 목록에 없음
    expect(map.get(PRODUCT_A)).not.toContain('미러리스')
  })

  it('click_count < promoteThreshold인 항목은 맵에서 제외', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)

    // PRODUCT_B: '캐논'(1) → 임계값 미만, 맵에 없음
    expect(map.has(PRODUCT_B)).toBe(false)
  })

  it('click_count === promoteThreshold는 정확히 경계값에서 포함', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)

    // 'a7iv'(3) = promoteThreshold(3) → 포함돼야 함 (gte, 이상)
    expect(map.get(PRODUCT_A)).toContain('a7iv')
  })

  it('다중 상품: 각 상품의 학습어가 독립적으로 분리됨', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)

    // PRODUCT_A의 학습어가 PRODUCT_C에 영향 없음
    expect(map.get(PRODUCT_C)).not.toContain('소니 카메라')
    expect(map.get(PRODUCT_C)).not.toContain('a7iv')

    // PRODUCT_C는 자신의 학습어만 보유
    expect(map.get(PRODUCT_C)).toEqual(expect.arrayContaining(['짐벌', 'DJI']))
    expect(map.get(PRODUCT_C)).toHaveLength(2)
  })

  it('통계 데이터 없음(빈 배열) → 빈 맵 반환 (안전 폴백)', () => {
    const map = buildLearnedTermsMap([], PROMOTE_THRESHOLD)
    expect(map.size).toBe(0)
  })

  it('높은 임계값 → 아무것도 승격되지 않음', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, 100)
    expect(map.size).toBe(0)
  })

  it('임계값 1 → click_count >= 1인 항목 전부 승격', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, 1)
    // 모든 product가 1회 이상 클릭됐으므로 전부 맵에 포함
    expect(map.has(PRODUCT_A)).toBe(true)
    expect(map.has(PRODUCT_B)).toBe(true)
    expect(map.has(PRODUCT_C)).toBe(true)
  })
})

describe('J-2: 인덱스 키워드 병합 — keywords_text 생성', () => {
  it('기본 키워드 + 학습어 병합', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)
    const result = mergeLearnedKeywords(['카메라', '풀프레임'], PRODUCT_A, map)

    // 기본 키워드가 앞에 오고 학습어가 뒤에 추가됨
    expect(result).toContain('카메라')
    expect(result).toContain('풀프레임')
    expect(result).toContain('소니 카메라')
    expect(result).toContain('a7iv')
    // 승격 제외된 '미러리스'는 없음
    expect(result).not.toContain('미러리스')
  })

  it('학습어 없는 상품: 기본 keywords_text만 반환 (PRODUCT_B)', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)
    const result = mergeLearnedKeywords(['카메라', '캐논'], PRODUCT_B, map)

    expect(result).toBe('카메라 캐논')
    // 학습어가 없으므로 기본값만 있어야 함
  })

  it('기본 키워드 없는 상품도 학습어만으로 keywords_text 생성 가능', () => {
    const map = buildLearnedTermsMap(MOCK_STATS, PROMOTE_THRESHOLD)
    const result = mergeLearnedKeywords([], PRODUCT_C, map)

    // 기본 키워드는 없지만 학습어('짐벌', 'DJI')가 병합됨
    expect(result).toContain('짐벌')
    expect(result).toContain('DJI')
  })

  it('빈 학습 맵 → 기본 keywords_text 그대로 유지', () => {
    const emptyMap = new Map<string, string[]>()
    const result = mergeLearnedKeywords(['카메라', '풀프레임'], PRODUCT_A, emptyMap)
    expect(result).toBe('카메라 풀프레임')
  })

  it('기본 키워드도, 학습어도 없는 상품 → 빈 문자열', () => {
    const emptyMap = new Map<string, string[]>()
    const result = mergeLearnedKeywords([], 'nonexistent-product', emptyMap)
    expect(result).toBe('')
  })
})

describe('J-2: extractJsonbKeyValues — components·specifications 텍스트 변환', () => {
  it('일반 key-value 객체 → "키 값" 형태 공백 연결', () => {
    const components = { '배터리': '1개', '충전케이블': '1개', '렌즈캡': '2개' }
    const result = extractJsonbKeyValues(components)
    expect(result).toContain('배터리')
    expect(result).toContain('1개')
    expect(result).toContain('충전케이블')
    expect(result).toContain('렌즈캡')
  })

  it('사양 객체도 동일 패턴 처리', () => {
    const specs = { '화소수': '3300만', '배터리용량': '2280mAh', '무게': '658g' }
    const result = extractJsonbKeyValues(specs)
    expect(result).toContain('화소수')
    expect(result).toContain('3300만')
    expect(result).toContain('배터리용량')
    expect(result).toContain('2280mAh')
  })

  it('null 입력 → 빈 문자열 (안전 처리)', () => {
    expect(extractJsonbKeyValues(null)).toBe('')
  })

  it('undefined 입력 → 빈 문자열', () => {
    expect(extractJsonbKeyValues(undefined)).toBe('')
  })

  it('배열 입력 → 빈 문자열 (JSONB 배열은 객체 아님)', () => {
    expect(extractJsonbKeyValues(['배터리', '렌즈'])).toBe('')
  })

  it('빈 객체 → 빈 문자열', () => {
    expect(extractJsonbKeyValues({})).toBe('')
  })

  it('value가 null인 키 → 키만 포함 (null 값은 Skip)', () => {
    const components = { '배터리': null, '충전케이블': '1개' }
    const result = extractJsonbKeyValues(components)
    // '배터리' 키는 포함되고 null 값은 제외
    expect(result).toContain('배터리')
    expect(result).toContain('충전케이블')
    expect(result).toContain('1개')
    expect(result).not.toContain('null')
  })

  it('숫자 value → 문자열로 변환돼 포함됨', () => {
    const specs = { '무게': 658, '화소수': 33000000 }
    const result = extractJsonbKeyValues(specs)
    expect(result).toContain('658')
    expect(result).toContain('33000000')
  })
})

describe('J-2: 캐시 무효화 — 학습어 캐시와 인덱스 캐시 동시 초기화', () => {
  it('invalidateProductSearchCache 호출 시 동작 시뮬레이션 (순수 로직)', () => {
    // 캐시 상태를 순수 변수로 재현
    let cachedIndex: string | null = 'built-index'
    let cachedAt = Date.now()
    let cachedPromoteThreshold: number | null = 3
    let promoteThresholdCachedAt = Date.now()

    // 무효화 실행
    function invalidate() {
      cachedIndex = null
      cachedAt = 0
      cachedPromoteThreshold = null
      promoteThresholdCachedAt = 0
    }
    invalidate()

    // 양쪽 캐시가 모두 초기화됐어야 함
    expect(cachedIndex).toBeNull()
    expect(cachedAt).toBe(0)
    expect(cachedPromoteThreshold).toBeNull()
    expect(promoteThresholdCachedAt).toBe(0)
  })

  it('TTL 만료 시 캐시 무효 판정 로직 검증', () => {
    const CACHE_TTL_MS = 60_000

    const now = Date.now()

    // 유효한 캐시 (30초 전 생성)
    const cachedAt = now - 30_000
    expect(cachedAt > now - CACHE_TTL_MS).toBe(true)  // 아직 유효

    // 만료된 캐시 (70초 전 생성)
    const expiredAt = now - 70_000
    expect(expiredAt > now - CACHE_TTL_MS).toBe(false)  // 만료됨
  })
})

describe('J-2: promote_threshold 폴백 동작', () => {
  it('DB 조회 실패 시 기본값(3) 반환 시뮬레이션', async () => {
    // loadPromoteThreshold()의 catch 분기 재현
    const FALLBACK = 3

    async function loadPromoteThresholdSim(dbFails: boolean): Promise<number> {
      try {
        if (dbFails) throw new Error('DB 연결 실패')
        return 5  // DB에서 받아온 값
      } catch {
        return FALLBACK
      }
    }

    // DB 정상
    expect(await loadPromoteThresholdSim(false)).toBe(5)
    // DB 실패 → 폴백 3 반환
    expect(await loadPromoteThresholdSim(true)).toBe(FALLBACK)
  })

  it('학습어 조회 실패 시 빈 맵 반환 → 기본 keywords_text 유지', () => {
    // loadLearnedSearchTerms 오류 시 빈 Map이 반환되고 mergeLearnedKeywords는 기본값만 씀
    const emptyMap = new Map<string, string[]>()  // 오류 시 빈 맵
    const result = mergeLearnedKeywords(['카메라', '풀프레임'], PRODUCT_A, emptyMap)
    expect(result).toBe('카메라 풀프레임')  // 기본값 그대로
  })
})
