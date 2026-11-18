/**
 * core/compoundQuery.ts — 붙여 쓴 검색어 분리 + 한글 브랜드의 영문 표기 후보 (2026-11-17, Stephen 지시)
 *
 * 증상: "니콘카메라"처럼 공백 없이 붙여 쓰면 검색이 비었다. 원인은 두 가지였다.
 *  ① 색인은 단어 "앞부분"만 맞추는데 질의 "니콘카메라"는 한 덩어리라 어떤 단어의 앞부분도 아니다
 *     (상품 쪽 붙임말은 compound_heads 칸으로 풀어 두었지만 "질의 쪽" 붙임말은 풀지 않았다).
 *  ② 상품 데이터에는 영문 "Nikon"만 있고 한글 "니콘"이 없다 — 동의어(니콘↔Nikon)가 확정되기 전에는 이어 줄 방법이 없었다.
 * 해결: ① 끝말(카메라·렌즈…)로 끝나는 붙임말을 "니콘 카메라"로 나눈다 ② 한글 단어를 영문 발음 후보("nikon")로 바꿔 함께 찾는다.
 *
 * ⚠️ core/ 격리 원칙: Supabase·$env·SvelteKit 의존 금지. 순수 TypeScript만.
 */

/**
 * 끝말 사전 — 상품 종류를 뜻하는 말. adapters/productSearchDocs.ts의 COMPOUND_HEAD_WORDS가 이 값을 그대로 쓴다(정본은 여기 하나).
 * 새 종류가 필요하면 여기에 추가하고 테스트 표를 갱신한다.
 */
export const DEFAULT_COMPOUND_HEADS: readonly string[] = [
  '카메라', '렌즈', '삼각대', '모니터', '배터리', '마이크', '슬라이더', '캠코더', '조명', '짐벌', '드론',
  '어댑터', '마운트', '거치대', '셀카봉', '스트랩', '하네스', '필터', '케이블', '충전기', '프롬프터', '스탠드', '후드',
  '액션캠', '미러리스',
]

/** 영문 후보를 만들지 않는 말 — 상품 이름이 아니라 흔한 요청·일반어라 후보가 잡음만 늘린다 */
const BRIDGE_SKIP_WORDS: ReadonlySet<string> = new Set([
  '추천', '문의', '대여', '렌탈', '렌트', '가격', '예약', '요금', '대여료', '상품', '제품', '장비', '세트',
  '줘요', '주세요', '알려줘', '알려줘요', '알려주세요', '부탁', '부탁해', '부탁해요', '해줘', '해줘요', '있어요', '있나요',
])

const MIN_STEM = 2 // 끝말 앞에 최소 2글자(니콘 등 한글 브랜드는 대부분 2글자 이상)
const HANGUL_ONLY = /^[가-힣]+$/
const LATIN_THEN_HANGUL = /^([a-z0-9][a-z0-9.-]*)([가-힣]+)$/i

function sortedHeads(heads: readonly string[]): string[] {
  return [...new Set(heads.map((h) => h.trim()).filter((h) => h.length >= 2))].sort((a, b) => b.length - a.length)
}

/**
 * 붙여 쓴 검색어를 끝말 기준으로 나눈다. 바뀌는 게 없으면 입력 그대로(공백만 정리) 돌려준다.
 *  · "니콘카메라" → "니콘 카메라" / "카메라삼각대" → "카메라 삼각대" / "nikon카메라" → "nikon 카메라"
 *  · 끝말 앞이 2글자 미만이거나 단어가 끝말과 똑같으면 나누지 않는다
 *  · 여러 단어 검색어는 단어마다 따로 판단한다
 */
export function splitCompoundQuery(query: string, extraHeads: readonly string[] = []): string {
  const trimmed = (query ?? '').trim()
  if (!trimmed) return ''
  const heads = sortedHeads([...DEFAULT_COMPOUND_HEADS, ...extraHeads])
  const headSet = new Set(heads.map((h) => h.toLowerCase()))
  const out = trimmed.split(/\s+/).map((token) => {
    const mixed = LATIN_THEN_HANGUL.exec(token)
    if (mixed && headSet.has(mixed[2].toLowerCase())) return `${mixed[1]} ${mixed[2]}`
    if (!HANGUL_ONLY.test(token) || token.length < MIN_STEM + 2) return token
    for (const h of heads) {
      if (token === h) return token
      if (token.endsWith(h) && token.length - h.length >= MIN_STEM) return `${token.slice(0, -h.length)} ${h}`
    }
    return token
  })
  return out.join(' ')
}

// ── 한글 → 영문 발음 후보 ────────────────────────────────────────────────────

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const VOWELS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
]
const FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
]

/** 영어식 표기로 다듬은 초성·중성 — 브랜드는 로마자 표기법보다 영어 철자에 가깝게 쓰이는 경우가 많다(캐논=Canon, 시그마=Sigma) */
function englishLean(initial: string, vowel: string, nextInitial: string): { initial: string; vowel: string } {
  let i = initial
  let v = vowel
  if (i === 'k' && /^(a|ae|o|u|eo|eu)/.test(v)) i = 'c' // 캐논 → canon (ㅋ + ㅏ/ㅐ/ㅗ/ㅜ는 c)
  if (v === 'ae') v = 'a'
  if (v === 'eo') v = 'o'
  if (v === 'eu') v = nextInitial === '' ? 'e' : '' // 시그마 → sigma (ㅡ는 소리가 약해 생략)
  if (v === 'yeo') v = 'yo'
  return { initial: i, vowel: v }
}

function romanize(word: string, lean: boolean): string {
  const syllables: { i: number; v: number; f: number }[] = []
  for (const ch of word) {
    const code = ch.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) return ''
    syllables.push({ i: Math.floor(code / 588), v: Math.floor((code % 588) / 28), f: code % 28 })
  }
  let out = ''
  for (const [idx, s] of syllables.entries()) {
    let initial = INITIALS[s.i]
    let vowel = VOWELS[s.v]
    if (lean) {
      const next = syllables[idx + 1]
      const adj = englishLean(initial, vowel, next ? INITIALS[next.i] : 'x')
      initial = adj.initial
      vowel = adj.vowel
    }
    out += initial + vowel + FINALS[s.f]
  }
  return out
}

/**
 * 한글 단어 하나의 영문 발음 후보(최대 2개: 로마자 표기법식 / 영어 철자식). 한글이 아니거나 너무 짧거나 긴 단어는 빈 배열.
 *  · 니콘 → ["nikon", "nicon"] / 캐논 → ["kaenon", "canon"] / 시그마 → ["sigeuma", "sigma"] / 로데 → ["rode"]
 * 이 값은 "검색어를 더 찾아 주는 보조 후보"로만 쓴다 — 후보가 틀려도 원래 검색 결과는 바뀌지 않고, 맞으면 영문 상호가 붙는다.
 */
export function hangulToLatinVariants(word: string): string[] {
  const w = (word ?? '').trim()
  if (w.length < 2 || w.length > 8 || !HANGUL_ONLY.test(w)) return []
  const out = new Set<string>()
  for (const lean of [false, true]) {
    const v = romanize(w, lean)
    if (v.length >= 3) out.add(v)
  }
  return [...out]
}

/** 영문 후보 전체 상한 — 공개 API 요청당 검색 횟수를 묶는다 */
export const MAX_BRIDGE_TERMS = 4

/**
 * 검색어의 한글 단어(끝말·요청어 제외)를 영문 발음 후보로 바꾼 목록. 영문 후보 하나가 곧 하나의 보조 검색어다.
 * 예) "니콘 카메라" → ["nikon", "nicon"] (카메라는 끝말 사전 단어라 제외)
 */
export function latinBridgeTerms(
  query: string,
  extraHeads: readonly string[] = [],
  /** 이미 확정 동의어가 영문 표기를 이어 주는 단어 — 영문 후보를 만들지 않는다(중복 검색 방지) */
  skipTokens: ReadonlySet<string> = new Set(),
): string[] {
  const q = (query ?? '').trim()
  if (!q) return []
  const headSet = new Set(sortedHeads([...DEFAULT_COMPOUND_HEADS, ...extraHeads]).map((h) => h.toLowerCase()))
  const out: string[] = []
  for (const token of q.split(/\s+/)) {
    if (!HANGUL_ONLY.test(token)) continue
    if (headSet.has(token.toLowerCase()) || BRIDGE_SKIP_WORDS.has(token) || skipTokens.has(token.toLowerCase())) continue
    for (const v of hangulToLatinVariants(token)) {
      if (out.length >= MAX_BRIDGE_TERMS) return out
      if (!out.includes(v)) out.push(v)
    }
  }
  return out
}
