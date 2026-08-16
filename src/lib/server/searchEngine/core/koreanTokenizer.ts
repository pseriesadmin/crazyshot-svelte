/**
 * core/koreanTokenizer.ts — 한국어 자연어 검색 토크나이저
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다.
 * 의존성: 순수 TypeScript (런타임 의존성 없음).
 *
 * 기능:
 * 1. 조사 제거 — 한국어 어미 정규화 (matchCannedResponse.ts의 TRAILING_PARTICLES 단일 정본화)
 * 2. 초성 추출 — 한글 자음 검색 지원 (chosungSearch.ts 로직 재사용)
 * 3. MiniSearch tokenize/processTerm 훅 제공
 */

// ── 1. 조사 제거 ──────────────────────────────────────────────────────────────
// 원본: matchCannedResponse.ts TRAILING_PARTICLES (2026-08-06 단일 정본으로 이전)
// 긴 조사부터 시도해야 짧은 조사가 먼저 걸려 잘못 잘리는 것을 방지한다.

export const TRAILING_PARTICLES: readonly string[] = [
  '으로부터', '에게서', '이라도', '라도', '까지', '부터', '에서', '에게',
  '으로', '이나', '이랑', '랑', '와', '과', '도', '만', '는', '은', '이', '가', '을', '를', '의', '로', '나',
].sort((a, b) => b.length - a.length)

/**
 * 토큰 끝에 붙은 흔한 조사를 제거해 어간에 가깝게 정규화합니다.
 * 원본 조사 목록에서 정규화한 것으로, matchCannedResponse의 로직과 동일합니다.
 *
 * 2026-08-17 수정: "1글자 조사"(와·과·도·만·는·은·이·가·을·를·의·로·나)는 제거 후 남는 어간이
 * 최소 2자 이상일 때만 제거한다(기존엔 무조건 제거 — "문의"(2자) 끝의 "의"를 조사로 오인해
 * "문"(1자)만 남기는 오류가 있었음). "문의"·"동의"·"주의"처럼 1글자 조사 목록의 글자로 끝나는
 * 2음절 고유 단어가 CS 도메인에 흔한데, 1자로 뭉개지면 그 1자가 색인 전체에서 과도하게
 * 광범위하게 매칭돼 무관한 빠른답변과 충돌하는 원인이 됐다(빠른답변 매칭 정확도 저하 재현·수정).
 * "으로부터"·"까지"·"부터" 등 2글자 이상 조사는 문법적으로 훨씬 명확해 원래 규칙(어간 1자
 * 이상만 남으면 제거, 예: "집으로부터" → "집")을 그대로 유지한다.
 */
export function stripTrailingParticle(token: string): string {
  for (const p of TRAILING_PARTICLES) {
    if (!token.endsWith(p)) continue
    const minStemLength = p.length === 1 ? 2 : 1
    if (token.length - p.length >= minStemLength) return token.slice(0, -p.length)
  }
  return token
}

// ── 2. 초성 추출 ──────────────────────────────────────────────────────────────
// 원본: chosungSearch.ts의 extractChosung/toChosung (2026-08-06 core로 재사용)

const CHO_SEONG: readonly string[] = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

/**
 * 한글 문자 하나에서 초성을 추출합니다.
 * 한글이 아닌 문자는 그대로 반환합니다.
 */
export function extractChosung(char: string): string {
  const code = char.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return char
  const offset = code - 0xac00
  const choIdx = Math.floor(offset / 28 / 21)
  return CHO_SEONG[choIdx] ?? char // eslint-disable-line security/detect-object-injection
}

/**
 * 문자열의 초성 시퀀스를 반환합니다.
 * 예: "소니카메라" → "ㅅㄴㅋㅁㄹ"
 */
export function toChosung(text: string): string {
  return text.split('').map(extractChosung).join('').toLowerCase()
}

/**
 * 입력이 한글 자음만으로 구성된 초성 검색어인지 판별합니다.
 * 예: "ㅅㄴ" → true, "소니" → false
 */
export function isChosungQuery(query: string): boolean {
  return /^[ㄱ-ㅎ]+$/.test(query.trim())
}

// ── 3. MiniSearch 훅용 토크나이저 ────────────────────────────────────────────

/** MiniSearch의 tokenize 훅에 주입할 기본 토크나이저 */
export function koreanTokenize(text: string): string[] {
  // 공백·구두점·특수문자 기준으로 분리, 빈 토큰 제거
  return text
    .split(/[\s,.!?~·/\-_]+/)
    .filter((t) => t.length >= 1)
}

/**
 * MiniSearch의 processTerm 훅에 주입할 정규화 함수.
 * 소문자 변환 후 조사 제거 적용.
 */
export function koreanProcessTerm(term: string): string | null {
  const lower = term.toLowerCase()
  if (!lower || lower.length === 0) return null
  // 조사 제거 후 1자 미만이 되면 null 반환 (불용어 필터 역할)
  const stripped = stripTrailingParticle(lower)
  return stripped.length >= 1 ? stripped : null
}
