/**
 * core/crossLingualPatternExtractor.ts — 이중언어 괄호 패턴 추출기
 *
 * 한글↔영어 표기 쌍을 텍스트에서 순수 정규식으로 추출합니다.
 * 예: "소니(Sony) 카메라" → [{hangul:"소니", latin:"Sony"}]
 *     "Sony(소니) camera" → [{hangul:"소니", latin:"Sony"}]
 *
 * ⚠️ 절대 원칙 (nlsearch.md §6):
 *   - 이 파일은 crazyshot 전용 import를 절대 포함하지 않는다.
 *     (Supabase, $env, SvelteKit 타입 등 — ZERO dependency)
 *   - 런타임 의존성 없음. 순수 TypeScript + 정규식만 사용.
 *   - 외부 AI API, 임베딩, 벡터DB 없음.
 *
 * 추출 규칙:
 *   1. `한글(영문)` 패턴 — "소니(Sony)"
 *   2. `영문(한글)` 패턴 — "Sony(소니)"
 *   3. 괄호 안 내용이 순수 숫자·기호만이면 무시 (오탐 방지)
 *   4. 한글 파트: 최소 1자, 영문 파트: 최소 1글자 포함
 *   5. 동일 (hangul, latin) 쌍은 중복 제거
 *
 * 사용처:
 *   - src/lib/server/crossLingualSynonymScan.ts (§C — 실제 DB 등록)
 *   - src/__tests__/services/crossLingualPatternExtractor.test.ts (§B-2 유닛 테스트)
 */

/** 한글↔영어 표기 쌍 */
export interface BilingualPair {
  /** 한글 표기 */
  hangul: string
  /** 영문 표기 */
  latin: string
}

// ── 정규식 상수 ──────────────────────────────────────────────────────────────

/**
 * 한글 범위 (가-힣 완성형 + ㄱ-ㅎ 자모 포함)
 * 가-힣 : 완성형 한글 (가~힣)
 * ㄱ-ㅎ : 자음 자모 (ㄱ~ㅎ)
 */
const HANGUL_CHAR_RANGE = '가-힣ㄱ-ㅎ'

/**
 * 한글(영문) 패턴 — e.g., "소니(Sony)", "카메라(camera)"
 * - 한글 파트: 공백 없이 연속된 한글 1자 이상
 *   (\s 미포함 — "캐논 렌즈(lens)"에서 "렌즈"만 포착하게, 과도한 탐욕 방지)
 * - 괄호 안: 영문 시작 + 영문/숫자/공백/하이픈/점 혼합 (브랜드명 예: "Nikon D850")
 */
const HANGUL_THEN_LATIN_RE = new RegExp(
  `([${HANGUL_CHAR_RANGE}]+)\\(([A-Za-z][A-Za-z0-9\\s\\-._]*)\\)`,
  'g',
)

/**
 * 영문(한글) 패턴 — e.g., "Sony(소니)", "Canon(캐논)"
 * - 영문 파트: 영문 시작 + 영문/숫자/하이픈/점 혼합 (공백 미포함, 연속 단어)
 * - 괄호 안: 연속된 한글 1자 이상 (공백 미포함)
 */
const LATIN_THEN_HANGUL_RE = new RegExp(
  `([A-Za-z][A-Za-z0-9\\-._]*)\\(([${HANGUL_CHAR_RANGE}]+)\\)`,
  'g',
)

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 영문 파트가 최소 1자의 알파벳 글자를 포함하는지 검사 (순수 숫자·기호 오탐 방지) */
function hasAtLeastOneLetter(s: string): boolean {
  return /[A-Za-z]/.test(s)
}

/** 한글 파트가 최소 1자의 완성형 또는 자모 한글을 포함하는지 검사 */
function hasAtLeastOneHangul(s: string): boolean {
  return /[가-힣ㄱ-ㅎ]/.test(s)
}

// ── 메인 함수 ──────────────────────────────────────────────────────────────────

/**
 * 텍스트에서 한글↔영어 이중언어 괄호 패턴을 모두 추출합니다.
 *
 * @param text 검색 텍스트, 상품명, 채팅 메시지 등 임의 문자열
 * @returns BilingualPair 배열 (중복 제거, hangul/latin 모두 trim)
 *
 * @example
 * extractBilingualPairs("소니(Sony) 카메라 렌즈")
 * // → [{ hangul: "소니", latin: "Sony" }]
 *
 * extractBilingualPairs("Canon(캐논) 카메라는 좋아요")
 * // → [{ hangul: "캐논", latin: "Canon" }]
 *
 * extractBilingualPairs("일반 텍스트만 있음")
 * // → []
 */
export function extractBilingualPairs(text: string): BilingualPair[] {
  if (!text || !text.trim()) return []

  const pairs: BilingualPair[] = []
  // 중복 제거용 Set — "hangul|latin" 형식으로 정규화된 키
  const seen = new Set<string>()

  // 정규식을 초기화해 lastIndex 리셋 (g 플래그 사용 시 필수)
  HANGUL_THEN_LATIN_RE.lastIndex = 0
  LATIN_THEN_HANGUL_RE.lastIndex = 0

  // ── 패턴 1: 한글(영문) ─────────────────────────────────────────────────────
  for (const m of text.matchAll(HANGUL_THEN_LATIN_RE)) {
    const hangul = m[1]?.trim() ?? ''
    const latin  = m[2]?.trim() ?? ''
    if (!hangul || !latin) continue
    if (!hasAtLeastOneHangul(hangul)) continue
    if (!hasAtLeastOneLetter(latin))  continue   // 오탐 방지: 숫자만 있는 경우 제외

    const key = `${hangul.toLowerCase()}|${latin.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      pairs.push({ hangul, latin })
    }
  }

  // ── 패턴 2: 영문(한글) ─────────────────────────────────────────────────────
  for (const m of text.matchAll(LATIN_THEN_HANGUL_RE)) {
    const latin  = m[1]?.trim() ?? ''
    const hangul = m[2]?.trim() ?? ''
    if (!hangul || !latin) continue
    if (!hasAtLeastOneHangul(hangul)) continue
    if (!hasAtLeastOneLetter(latin))  continue   // 오탐 방지

    const key = `${hangul.toLowerCase()}|${latin.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      pairs.push({ hangul, latin })
    }
  }

  return pairs
}
