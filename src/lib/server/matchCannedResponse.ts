// matchCannedResponse.ts — 자동답변 매칭 순수함수 (서버 전용)
// 하이브리드 자동답변 1단계: Claude 의도분류보다 먼저 실행되는 순수 키워드 매칭.
// intent/category 개념 없이 등록된 빠른답변 전체를 대상으로 판정한다 — AI 호출·API
// 키 상태와 완전히 무관하게 동작해야 하므로 여기서는 그 어떤 AI 결과값도 참조하지 않는다.
//
// 2026-10-06 판정 방식 교체 ("균형" 기준, Stephen 확정):
//   문제: 질문과 한 단어만 겹쳐도 무관한 빠른답변이 자동 발송돼 CS가 오히려 늘었다
//         (키워드 1개=+5점, 채택 기준 3점 → 단독 통과 / 오타허용·접두 매칭 / 일반어("되나요") 매칭).
//   원칙: ① 모르면 매칭하지 않는다 ② 다중 키워드 조합을 더 많이 설명하는 답변을 고른다
//         ③ 판정 불가(no_match·ambiguous)는 호출부가 "관리자 답변 대기 안내"로 처리한다.
//   방식: 질문을 "핵심 단어"로 쪼개고(조사·어미·인사·일반어 제외), 후보마다
//         - 근거(evidence): 서로 다른 개념(동의어는 1개)의 적중 점수 합
//         - 커버리지(coverage): 질문의 핵심 단어 중 이 후보가 설명하는 비율(글자 단위)
//         를 계산해 기준을 모두 넘고, 1·2등 격차가 충분할 때만 채택한다.
//   MiniSearch 점수는 더 이상 채택 근거로 쓰지 않는다(일반어 매칭 원인) — 본문(content) 단어는
//   약한 보조 근거로만 쓰며 단독으론 채택되지 않는다.
//   시그니처: matchCannedResponse(message, candidates, synonymGroups?) — 기존 호출부 호환.
//   상세 판정 결과가 필요하면 evaluateCannedMatch() (로깅·대기 안내 분기용).

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
  // GSD-20: 이미지/CTA 있는 canned_cta 액션카드 지원 (마이그레이션 232)
  image_url?: string | null
  cta_label?: string | null
  cta_url?: string | null
}

export type CannedMatchDecision = 'answer' | 'ambiguous' | 'no_match'

/**
 * 확률 모델(cannedMatchModel.ts)이 쓰는 후보별 특징값 — 판정 규칙이 이미 계산하는 값을 그대로 공개한 것이다.
 * 불리언은 0/1 숫자로 둔다(모델 입력 벡터 변환을 단순하게).
 */
export interface CannedMatchFeatures {
  evidence: number
  coverage: number
  /** 서로 다른 개념 수 */
  concepts: number
  /** 관리자가 직접 지정한(키워드·단축키) 개념 수 */
  curatedConcepts: number
  /** 등록 키워드·단축키 적중 여부 */
  curatedHit: 0 | 1
  /** 근거가 제목 단어뿐인지 */
  titleOnly: 0 | 1
  /** 단축키 적중 여부 */
  shortcutHit: 0 | 1
  /** 적중한 단어 중 가장 긴 글자 수 */
  maxTermLen: number
  /** 질문 핵심 단어 수 */
  tokenCount: number
  /** 질문 핵심 단어 중 일반어가 아닌 비율 */
  nonGenericRatio: number
  /** 본문 보조 점수 */
  contentBonus: number
  /** 근거와 맞지 않은 서술어(용언) 비중 */
  unexplainedVerbalRatio: number
  /** 이 후보가 설명하지 못하는 내용어(일반어·서술어 제외) 개수 — 질문에 낯선 명사가 많으면 다른 용건일 가능성 */
  unexplainedContentTokens: number
  /** 이 후보 종합점수 − 다른 후보 중 최고 점수(1등이면 2등과의 격차, 아니면 음수) */
  gapToBest: number
}

export interface CannedMatchCandidateScore {
  id: string
  /** 서로 다른 개념의 적중 점수 합(동의어는 1개 개념) */
  evidence: number
  /** 질문의 핵심 단어 중 이 후보가 설명하는 비율(0~1, 글자 단위) */
  coverage: number
  /** 정렬용 종합 점수 = evidence + 4×coverage */
  score: number
  /** 규칙 게이트(채택 최소 조건) 통과 여부 — 확률 모델은 통과한 후보에만 적용한다 */
  passesRules: boolean
  features: CannedMatchFeatures
}

export interface CannedMatchEvaluation {
  decision: CannedMatchDecision
  best: CannedResponseForMatch | null
  /** 채택 여부와 무관하게 상위 3개 후보의 수치(관찰 모드 로그·튜닝용) */
  top: CannedMatchCandidateScore[]
  /** 판정 사유 코드(로그용): ok | empty | no_candidates | no_meaningful_tokens | generic_only | non_question | below_threshold | ambiguous */
  reason: string
  /** 질문에서 뽑은 핵심 단어 수 */
  tokenCount: number
}

// ── 기준값(균형) ─────────────────────────────────────────────────────────────
const MIN_EVIDENCE = 1.2 // 이 이상이어야 후보 자격(짧은 키워드 단독·일반어 단독은 미달)
const MIN_COVERAGE = 0.55 // 근거가 약할 때(단일 개념) 요구하는 커버리지
const MIN_COVERAGE_TITLE_ONLY = 0.85 // 근거가 제목 단어뿐(등록 키워드·단축키 적중 없음)이면 질문을 거의 다 설명해야 함
const STRONG_EVIDENCE = 2.2 // 서로 다른 근거(개념) 2개 이상이면 완화된 커버리지 허용
const STRONG_MIN_CONCEPTS = 2
const MIN_COVERAGE_STRONG = 0.4
const AMBIGUOUS_MARGIN = 1.0 // 1·2등 종합점수 격차가 이보다 작으면 애매
const TIE_PICK_MIN_EVIDENCE = 2.0 // 애매해도 근거가 강하고 질문을 거의 다 설명하면 사용횟수로 선택
const TIE_PICK_MIN_COVERAGE = 0.8
const COVERAGE_WEIGHT = 4

// ── 불용어 / 일반어 ──────────────────────────────────────────────────────────
// 근거도 질문 핵심도 되지 않는 말: 인사·의문·요청 어미 등. 조사 제거(stripTrailingParticle) 후 비교한다.
const STOP_TOKENS = new Set([
  '안녕', '안녕하세요', '안녕하십니까', '감사', '감사합니다', '고맙습니다', '수고', '죄송', '죄송합니다',
  '저기', '저는', '제가', '혹시', '그냥', '일단', '그리고', '그런데', '근데', '그래서', '하지만', '그럼', '그게', '이게',
  '이거', '그거', '거기', '여기', '거기서', '여기서', '이것', '그것', '진짜', '정말', '너무', '많이', '매우', '아주', '계속',
  '어떻게', '어떤', '어디', '어디서', '언제', '누가', '무엇', '뭐가', '왜', '얼마', '얼마나', '얼마예요', '몇',
  '되나요', '되요', '돼요', '됩니까', '되는지', '되는건가요', '하나요', '해요', '합니까', '할까요', '있나요', '있어요', '있습니까',
  '없나요', '없어요', '가능', '가능한가요', '가능할까요', '가능해요', '인가요', '인지', '건가요', '인데요', '한데요', '하는데',
  '어때요', '어떤가요', '어떨까요', '안되요', '안돼요', '안됩니다', '안되는데', '안되네요', '하네요', '좋네요', '해야', '해야하나요',
  '때문에', '대해', '대한', '관해서', '관련', '관련해서', '다르게', '필요', '필요해요', '필요한데요',
  '하죠', '하는지', '할지', '될까요', '되는데', '되죠', '있는지', '없는지', '있는데', '없는데', '있을까요', '같은데', '같아서', '같습니다', '것같은데', '오후', '오전',
  '빌리고', '빌리려고', '빌려', '빌려요', '빌릴', '빌리면', '싶은데', '하려고', '못했어요', '안했어요', '않아요', '있습니다', '없습니다', '합니다만',
  '해주세요', '주세요', '부탁', '부탁드려요', '부탁드립니다', '알려주세요', '알려', '알고싶어요', '궁금', '궁금해요', '궁금합니다',
  '알려줘', '알려줘요', '알려달라고', '알려줄래', '알려줄래요', '알려주실래요', '해줘', '해줘요', '해줄래요', '부탁해', '부탁해요', '부탁합니다', '할께요', '할게요', '하고싶어요', '하고싶은데',
  '문의', '질문', '확인', '요청', '안내', '싶어요', '싶어', '싶습니다', '갑니다', '합니다', '같아요', '오늘', '내일', '어제', '지금',
  // 의문·되묻기 말투(2026-10-08) — 주제를 가리키지 않는 말만 추가한다. 명사 주제어("장소"·"위치"·"비용" 등)는 절대 넣지 않는다.
  '어디예요', '어디에요', '어딘가요', '어디인가요', '어디인지', '어딘지', '어디로', '어디에', '어디쯤', '어디있나요', '어디에있나요',
  '얼마에요', '얼마인지', '얼마정도', '얼마쯤', '얼마죠', '얼마입니까', '얼마인데요', '얼마나요', '얼마나와요', '나와요',
  '뭐예요', '뭐에요', '뭔가요', '뭔지', '뭐', '뭘', '무슨', '무엇', '무엇인가요',
  '언제예요', '언제인가요', '언제쯤', '언제까지', '언제부터', '언제인지',
  '어떤걸', '어떤건가요', '어떤지', '어떻게든',
  '가야', '가면', '올려야', '내야', '내요', '돼요', '되어', '되어있나요', '알고', '알고싶습니다', '좀',
  '직접', '바로', '다음에', '가도', '보내요', '받을', '받아요', '주시나요', '필요한가요', '없이', '채로', '신청해야', '쉬는', '날에',
])
// 문의·질문·궁금·부탁 등 + 흔한 어미 조합("문의드려요", "궁금한데요")
const STOP_ROOT_ENDING_RE = /^(문의|질문|궁금|부탁|관련|확인|요청|알려|알고|감사|죄송)(드려요|드립니다|드려|해요|합니다|해주세요|주세요|해서|한데요|하는데|합니다만|했어요|했는데|싶어요|싶어|싶습니다)?$/
// 질문 핵심이 아닌 날짜·수량 표현("10일", "3개")
const NUMERIC_TOKEN_RE = /^\d+(일|시|월|개|명|원|%|박|대|번|주|분|달|년|개월|시간|일간|달간|주일|정도|쯤|이상|이내|동안)*$/
// 업종 일반어 — 설명 근거로는 약하고(단독 채택 불가), 질문에서 비중도 낮게 본다
const DOMAIN_GENERIC = new Set(['카메라', '렌즈', '장비', '상품', '제품', '물건', '대여', '렌탈', '렌트', '고객', '서비스', '이용', '방법', '빌리', '처리', '신청'])
// 어간 뒤 흔한 용언 어미 — 커버리지는 어간 기준으로 계산("고장났어요" → 어간 "고장")
const VERB_ENDING_RE = /(쳐서|려서|와서|가서|어서|아서|여서|았는데요|었는데요|았는데|었는데|았어요|었어요|았습니다|었습니다|났는데요|났어요|했는데요|했어요|했습니다|했는데|하는데|해서요|하려면|하려고|하러|하고|해서|하면|해요|합니다|되요|돼요|됩니다|인데요|인데|이에요|예요|네요|는데요|은데|는데|습니다|세요|까요|한가요|인가요|나요|할)$/
// 어간 끝의 포괄 접미어("파손처리" → "파손") — 커버리지 분모에서 제외
const GENERIC_SUFFIX_RE = /(처리|문제|관련|방법|문의|접수)$/

// ── 보조 함수 ────────────────────────────────────────────────────────────────

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

const HANGUL_RE = /[가-힣]/
const SPLIT_RE = /[\s,.!?~·/()'"“”‘’[\]{}:;+\-_=<>|*&^%$#@]+/

function isStopToken(t: string): boolean {
  return STOP_TOKENS.has(t) || STOP_ROOT_ENDING_RE.test(t) || NUMERIC_TOKEN_RE.test(t)
}

interface QuestionToken {
  text: string
  /** 어미를 뗀 어간 길이(커버리지 분모 기준) */
  stemLen: number
  hangul: boolean
  generic: boolean
  weight: number
  /** 어미가 붙은 용언형 — 근거와 맞지 않으면 분모에서 약하게만 반영 */
  verbal: boolean
  /** 어미를 떼면 어간이 1글자 이하("깨졌어요", "생겼어요") — 근거와 맞을 때만 반영 */
  predicateOnly: boolean
}

/** 한글 음절의 종성이 ㅆ인지(과거형 어미: 았·었·겠·졌·겼·났·했…) */
function hasSsangSiotFinal(ch: string): boolean {
  const code = ch.charCodeAt(0) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 === 20
}

// 과거형 어미("…ㅆ" 음절 + 어요/는데/습니다 등)를 뗀 어간. 못 뗐으면 null
const PAST_TAIL_RE = /^(어요|어서|어|는데요|는데|습니다|네요|지만|고)?$/
function stripPastTense(token: string): string | null {
  for (let i = token.length - 1; i >= 1; i--) {
    if (!hasSsangSiotFinal(token[i])) continue
    if (PAST_TAIL_RE.test(token.slice(i + 1))) return token.slice(0, i)
    break
  }
  return null
}

function tokenizeQuestion(message: string): QuestionToken[] {
  const tokens: QuestionToken[] = []
  for (const raw of message.toLowerCase().split(SPLIT_RE)) {
    if (raw.length < 2) continue
    const t = stripTrailingParticle(raw)
    if (t.length < 2 || isStopToken(t)) continue
    const hangul = HANGUL_RE.test(t)
    let stemLen = t.length
    let stem = t
    let verbal = false
    let predicateOnly = false
    if (hangul) {
      const past = stripPastTense(t)
      const noEnding = past ?? t.replace(VERB_ENDING_RE, '')
      if (past !== null || noEnding !== t) {
        verbal = true
        // 어미를 떼면 1글자 이하만 남는 서술어("했는데", "안해서요", "깨졌어요")는 근거와 맞을 때만 반영
        if (noEnding.length < 2) predicateOnly = true
      }
      if (noEnding.length >= 2) stem = noEnding
      const noSuffix = stem.replace(GENERIC_SUFFIX_RE, '')
      if (noSuffix.length >= 2) stem = noSuffix
      stemLen = predicateOnly ? Math.min(t.length, 4) : stem.length
    }
    const generic = DOMAIN_GENERIC.has(t) || DOMAIN_GENERIC.has(stem)
    const base = hangul ? Math.min(stemLen, 6) : Math.min(t.length, 3)
    tokens.push({ text: t, stemLen, hangul, generic, weight: base * (generic ? 0.35 : 1), verbal, predicateOnly })
  }
  return tokens
}

type HitKind = 'exact' | 'prefix' | 'inner' | 'contained' | 'fuzzy'

/** 근거 단어(term)가 질문 토큰에 적중하는지와 방식. term은 소문자·2자 이상이어야 한다. */
function hitKind(term: string, token: string): HitKind | null {
  if (token === term) return 'exact'
  if (token.includes(term)) return token.startsWith(term) ? 'prefix' : 'inner'
  if (token.length >= 3 && term.includes(token) && term.length - token.length <= 3) return 'contained'
  if (token.length >= 4 && term.length >= 4 && Math.abs(token.length - term.length) <= 1 && levenshtein(token, term) <= 1) return 'fuzzy'
  return null
}

function kindFactor(kind: HitKind, termLen: number): number {
  switch (kind) {
    case 'exact':
    case 'prefix':
      return 1
    case 'contained':
      return 0.8
    case 'fuzzy':
      return 0.9
    case 'inner':
      return termLen >= 3 ? 0.9 : 0.6
  }
}

interface EvidenceTerm {
  /** 같은 개념 묶음 키(동의어는 그룹 대표어, 그 외엔 단어 자신) */
  key: string
  term: string
  /** 단어 자체의 강도(길이·출처 기준) */
  base: number
  generic: boolean
  /** 관리자가 직접 지정한 근거(등록 키워드·단축키) 여부 — 제목 단어와 구분 */
  curated: boolean
  source: 'keyword' | 'shortcut' | 'title'
}

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(SPLIT_RE)
    .map(stripTrailingParticle)
    .filter((w) => w.length >= 2 && !isStopToken(w))
}

function buildEvidenceTerms(
  item: CannedResponseForMatch,
  synonymGroups: SynonymGroupData[],
  titleWordFreq: Map<string, number>,
): EvidenceTerm[] {
  const terms: EvidenceTerm[] = []
  const groupKeyOf = (term: string): string => {
    const lower = term.toLowerCase()
    for (const g of synonymGroups) {
      if (g.canonicalTerm.toLowerCase() === lower || g.confirmedTerms.some((x) => x.toLowerCase() === lower)) {
        return `syn:${g.canonicalTerm.toLowerCase()}`
      }
    }
    return lower
  }

  // match_keywords(+동의어 확장) — 관리자가 명시한 가장 강한 근거. 동의어는 같은 key로 묶인다
  const keywords = synonymGroups.length > 0
    ? expandKeywordsWithSynonyms(item.match_keywords ?? [], synonymGroups)
    : (item.match_keywords ?? [])
  for (const kw of keywords) {
    const term = kw.toLowerCase().trim()
    if (term.length < 2) continue
    terms.push({ key: groupKeyOf(term), term, base: term.length >= 3 ? 2.0 : 1.2, generic: DOMAIN_GENERIC.has(term), curated: true, source: 'keyword' })
  }

  // shortcut — 관리자가 직접 지정한 호출어
  const shortcutWord = item.shortcut ? item.shortcut.replace(/^\//, '').toLowerCase().trim() : ''
  if (shortcutWord.length >= 2) {
    terms.push({ key: groupKeyOf(shortcutWord), term: shortcutWord, base: 2.5, generic: DOMAIN_GENERIC.has(shortcutWord), curated: true, source: 'shortcut' })
  }

  // title 단어 — 다른 후보 제목에 자주 나오는 단어일수록 약하다
  for (const w of new Set(splitWords(item.title))) {
    const freq = titleWordFreq.get(w) ?? 1
    const base = freq <= 1 ? 1.5 : freq === 2 ? 0.8 : 0.4
    terms.push({ key: groupKeyOf(w), term: w, base, generic: DOMAIN_GENERIC.has(w) || freq >= 3, curated: false, source: 'title' })
  }
  return terms
}

function scoreCandidate(
  item: CannedResponseForMatch,
  tokens: QuestionToken[],
  synonymGroups: SynonymGroupData[],
  titleWordFreq: Map<string, number>,
): {
  evidence: number
  coverage: number
  nonGenericExplained: boolean
  concepts: number
  curatedHit: boolean
  curatedConcepts: number
  shortcutHit: boolean
  maxTermLen: number
  contentBonus: number
  unexplainedVerbalRatio: number
  unexplainedContentTokens: number
} {
  const terms = buildEvidenceTerms(item, synonymGroups, titleWordFreq)

  // 개념(key)별 최고 적중값 — 같은 뜻을 여러 번 말해도 근거는 1개
  const conceptBest = new Map<string, number>()
  // 토큰별: 최고 적중값 + 덮은 글자 집합
  const tokenBest = tokens.map(() => 0)
  const tokenCovered = tokens.map(() => new Set<number>())
  const tokenNonGeneric = tokens.map(() => false)
  let curatedHit = false
  const curatedKeys = new Set<string>()
  let shortcutHit = false
  let maxTermLen = 0

  for (const term of terms) {
    for (let i = 0; i < tokens.length; i++) {
      const kind = hitKind(term.term, tokens[i].text)
      if (!kind) continue
      const value = term.base * kindFactor(kind, term.term.length)
      if (value > (conceptBest.get(term.key) ?? 0)) conceptBest.set(term.key, value)
      if (value > tokenBest[i]) tokenBest[i] = value
      if (kind === 'exact' || kind === 'fuzzy' || kind === 'contained') {
        for (let c = 0; c < tokens[i].stemLen; c++) tokenCovered[i].add(c)
      } else {
        const start = tokens[i].text.indexOf(term.term)
        for (let c = start; c < start + term.term.length && c < tokens[i].stemLen; c++) tokenCovered[i].add(c)
      }
      if (!term.generic && !tokens[i].generic) tokenNonGeneric[i] = true
      if (term.curated && !term.generic) {
        curatedHit = true
        curatedKeys.add(term.key)
      }
      if (term.source === 'shortcut') shortcutHit = true
      if (term.term.length > maxTermLen) maxTermLen = term.term.length
    }
  }

  // 복합 키워드(2026-10-08): 키워드는 "반납장소"처럼 붙여 쓰지만 질문은 "반납 장소"로 띄어 오는 경우가 많다.
  // 이웃한 두 단어를 붙인 말이 키워드와 같거나 그 키워드로 시작하면(exact/prefix) 두 단어를 함께 설명된 것으로 본다.
  // 순서가 뒤바뀌거나 이웃하지 않은 단어는 합치지 않는다.
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i]
    const b = tokens[i + 1]
    if (!a.hangul || !b.hangul) continue
    const joined = a.text + b.text
    for (const term of terms) {
      if (term.term.length < 4) continue
      const kind = hitKind(term.term, joined)
      if (kind !== 'exact' && kind !== 'prefix') continue
      const value = term.base * kindFactor(kind, term.term.length)
      if (value > (conceptBest.get(term.key) ?? 0)) conceptBest.set(term.key, value)
      for (const idx of [i, i + 1]) {
        if (value > tokenBest[idx]) tokenBest[idx] = value
        for (let c = 0; c < tokens[idx].stemLen; c++) tokenCovered[idx].add(c)
        if (!term.generic && !tokens[idx].generic) tokenNonGeneric[idx] = true
      }
      if (term.curated && !term.generic) {
        curatedHit = true
        curatedKeys.add(term.key)
      }
      if (term.source === 'shortcut') shortcutHit = true
      if (term.term.length > maxTermLen) maxTermLen = term.term.length
    }
  }

  // 일반어·약한 근거 보정: 단일 개념 값이 너무 낮으면 증거로 치지 않는다(합산은 그대로)
  let evidence = 0
  for (const v of conceptBest.values()) evidence += v
  const concepts = conceptBest.size

  // 본문(content) 보조 근거 — 단어(3자 이상, 일반어 제외)가 본문에 있으면 +0.3, 최대 +0.6. 단독 채택 불가
  const contentLower = item.content.toLowerCase()
  let contentBonus = 0
  for (const t of tokens) {
    if (contentBonus >= 0.6) break
    if (t.hangul && !t.generic && t.text.length >= 3 && contentLower.includes(t.text)) contentBonus += 0.3
  }
  evidence += contentBonus

  let total = 0
  let explained = 0
  let unexplainedVerbal = 0
  let unexplainedContent = 0
  let nonGenericExplained = false
  for (let i = 0; i < tokens.length; i++) {
    const explainedToken = tokenBest[i] > 0
    if (explainedToken) total += tokens[i].weight
    else if (tokens[i].predicateOnly) continue
    else {
      const w = tokens[i].weight * (tokens[i].verbal ? 0.6 : 1)
      total += w
      if (tokens[i].verbal) unexplainedVerbal += w
      else if (!tokens[i].generic) unexplainedContent += 1
    }
    if (!explainedToken) continue
    const strength = tokenBest[i] >= 1.0 ? 1 : tokenBest[i] >= 0.4 ? 0.5 : 0
    const phi = Math.min(1, tokenCovered[i].size / Math.max(1, tokens[i].stemLen))
    explained += tokens[i].weight * strength * phi
    if (tokenNonGeneric[i] && strength > 0) nonGenericExplained = true
  }
  const coverage = total > 0 ? explained / total : 0
  return {
    evidence, coverage, nonGenericExplained, concepts, curatedHit,
    curatedConcepts: curatedKeys.size, shortcutHit, maxTermLen, contentBonus,
    unexplainedVerbalRatio: total > 0 ? unexplainedVerbal / total : 0,
    unexplainedContentTokens: unexplainedContent,
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 고객 메시지에 대한 자동답변 판정 — 채택(answer)·애매(ambiguous)·미매칭(no_match).
 * 호출부는 answer일 때만 자동 발송하고, 그 외에는 "관리자 답변 대기" 안내로 처리한다.
 *
 * 채택 조건(균형): 후보별로
 *   (근거 ≥ 1.2 그리고 커버리지 ≥ 0.55 — 근거가 제목 단어뿐이면 커버리지 ≥ 0.85) 또는
 *   (근거 ≥ 2.2 그리고 서로 다른 개념 2개 이상 그리고 커버리지 ≥ 0.4),
 *   그리고 질문의 비(非)일반어 단어 하나 이상을 설명해야 한다.
 *   통과한 후보가 여럿이면 종합점수 1등이 2등보다 1.0 이상 앞서야 하며, 격차가 작아도
 *   1등의 근거가 강하고(≥2.0) 질문을 거의 다 설명하면(≥0.8) 사용횟수 높은 순으로 선택한다.
 */
export function evaluateCannedMatch(
  message: string,
  candidates: CannedResponseForMatch[],
  synonymGroups: SynonymGroupData[] = [],
): CannedMatchEvaluation {
  const none = (reason: string, tokenCount = 0, top: CannedMatchCandidateScore[] = []): CannedMatchEvaluation => ({
    decision: 'no_match', best: null, top, reason, tokenCount,
  })
  if (candidates.length === 0) return none('no_candidates')
  if (!message || !message.trim()) return none('empty')

  const tokens = tokenizeQuestion(message)
  if (tokens.length === 0) return none('no_meaningful_tokens')

  // 상품명·모델명 나열 같은 비질문: 한글 없는 토큰이 대부분이면 매칭하지 않는다
  const latinCount = tokens.filter((t) => !t.hangul).length
  if (tokens.length >= 3 && latinCount / tokens.length >= 0.5) return none('non_question', tokens.length)
  if (tokens.every((t) => t.generic)) return none('generic_only', tokens.length)

  const titleWordFreq = new Map<string, number>()
  for (const item of candidates) {
    for (const w of new Set(splitWords(item.title))) titleWordFreq.set(w, (titleWordFreq.get(w) ?? 0) + 1)
  }

  const scored = candidates.map((item) => {
    const s = scoreCandidate(item, tokens, synonymGroups, titleWordFreq)
    return { item, ...s, score: s.evidence + COVERAGE_WEIGHT * s.coverage }
  })
  scored.sort((a, b) => b.score - a.score)

  const passesRules = (s: (typeof scored)[number]): boolean => {
    if (!s.nonGenericExplained) return false
    const single = s.evidence >= MIN_EVIDENCE && s.coverage >= (s.curatedHit ? MIN_COVERAGE : MIN_COVERAGE_TITLE_ONLY)
    const strong = s.evidence >= STRONG_EVIDENCE && s.concepts >= STRONG_MIN_CONCEPTS && s.coverage >= MIN_COVERAGE_STRONG
    return single || strong
  }

  const nonGenericRatio = tokens.filter((t) => !t.generic).length / tokens.length
  const r3 = (n: number): number => Math.round(n * 1000) / 1000
  const top: CannedMatchCandidateScore[] = scored.slice(0, 3).map((s, idx) => {
    const otherBest = idx === 0 ? (scored[1]?.score ?? 0) : scored[0].score
    return {
      id: s.item.id,
      evidence: Math.round(s.evidence * 100) / 100,
      coverage: Math.round(s.coverage * 100) / 100,
      score: Math.round(s.score * 100) / 100,
      passesRules: passesRules(s),
      features: {
        evidence: r3(s.evidence),
        coverage: r3(s.coverage),
        concepts: s.concepts,
        curatedConcepts: s.curatedConcepts,
        curatedHit: s.curatedHit ? 1 : 0,
        titleOnly: s.curatedHit ? 0 : 1,
        shortcutHit: s.shortcutHit ? 1 : 0,
        maxTermLen: s.maxTermLen,
        tokenCount: tokens.length,
        nonGenericRatio: r3(nonGenericRatio),
        contentBonus: r3(s.contentBonus),
        unexplainedVerbalRatio: r3(s.unexplainedVerbalRatio),
        unexplainedContentTokens: s.unexplainedContentTokens,
        gapToBest: r3(s.score - otherBest),
      },
    }
  })

  const passing = scored.filter(passesRules)
  if (passing.length === 0) return none('below_threshold', tokens.length, top)

  const first = passing[0]
  const second = passing[1]
  if (second && first.score - second.score < AMBIGUOUS_MARGIN) {
    const strong = first.evidence >= TIE_PICK_MIN_EVIDENCE && first.coverage >= TIE_PICK_MIN_COVERAGE
    if (!strong) {
      return { decision: 'ambiguous', best: null, top, reason: 'ambiguous', tokenCount: tokens.length }
    }
    // 거의 같은 후보 중 사용횟수 → 제목 순(기존 동점 규칙과 동일)
    const near = passing.filter((p) => first.score - p.score < AMBIGUOUS_MARGIN)
    near.sort((a, b) => {
      if (b.item.usage_count !== a.item.usage_count) return b.item.usage_count - a.item.usage_count
      return a.item.title.localeCompare(b.item.title, 'ko')
    })
    return { decision: 'answer', best: near[0].item, top, reason: 'ok', tokenCount: tokens.length }
  }
  return { decision: 'answer', best: first.item, top, reason: 'ok', tokenCount: tokens.length }
}

/**
 * 고객 메시지와 가장 잘 맞는 빠른답변을 반환합니다(채택 불가·애매하면 null).
 * 기존 호출부 호환용 래퍼 — 판정 상세가 필요하면 evaluateCannedMatch()를 사용하세요.
 */
export function matchCannedResponse(
  message: string,
  candidates: CannedResponseForMatch[],
  synonymGroups: SynonymGroupData[] = [],
): CannedResponseForMatch | null {
  return evaluateCannedMatch(message, candidates, synonymGroups).best
}
