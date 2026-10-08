// recommend.ts — 크레이지챗 추천형 순수 로직: 추천 질문 감지 · 검색어 추출 · 카드 후보 선정 · 고정 문구 (서버 전용)
// 원칙: 상품은 DB 검색 결과에서만 고른다(AI가 상품을 지어내지 않음). 대여 상품만(판매전용·옵션전용 제외), 최대 3장.
// 사람 전용 주제·타인 정보·예약 조회/접수 질문은 추천 대상이 아니다.

import { stripTrailingParticle } from '$lib/server/searchEngine/core/koreanTokenizer'
import { expandQueryWithConfirmedSynonyms, type SynonymGroup } from '$lib/server/searchEngine/core/synonymExpander'
import { classifyActionIntent } from './action'
import { classifyQueryIntent, MAX_QUESTION_LENGTH } from './query'
import { detectHumanOnlyTopic } from './topics'
import type { RecommendObservationMetrics } from './shared'

export const MAX_RECOMMEND_CARDS = 3

const RECOMMEND_RE =
  /추천|뭐가\s?(좋|나아|괜찮)|어떤\s?[가-힣A-Za-z0-9]{0,8}\s?(좋|쓰면|써야|빌려야|대여해야|골라)|어느\s?[가-힣A-Za-z0-9]{0,8}\s?(좋|쓰면|써야)|괜찮은\s?[가-힣A-Za-z0-9]{1,10}\s?(있|추천|없|알려)|골라\s?주/
// 추천인 코드·추천 이벤트·친구 추천처럼 "상품 추천"이 아닌 말
const NOT_PRODUCT_RECOMMEND_RE = /추천\s?인|추천\s?코드|추천\s?이벤트|친구\s?추천|추천\s?보상|추천\s?쿠폰|이벤트\s?추천/

/** 상품 추천을 요청하는 질문인지 */
export function isRecommendQuestion(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false
  const m = message.trim()
  if (m.length < 2 || m.length > Math.min(MAX_QUESTION_LENGTH, 200)) return false
  if (!RECOMMEND_RE.test(m) || NOT_PRODUCT_RECOMMEND_RE.test(m)) return false
  if (detectHumanOnlyTopic(m)) return false
  if (classifyQueryIntent(m) || classifyActionIntent(m)) return false
  return true
}

// 검색어에서 빼는 "추천 요청 표현"과 군더더기 — 토큰 단위로 비교한다(단어 중간을 자르지 않음: "저조도"·"저렴한"은 그대로 둔다)
const STRIP_PREFIX_RE = /^(추천|아무|찍|부탁|알려|골라|제안|괜찮|해주|좋(아|은|을|나|겠|네|다)|쓰려|하려|싶)/
const FILLER_TOKENS = new Set([
  '주세요', '뭐가', '어떤', '어느', '어떻게', '혹시', '그냥', '좀', '제가', '저는', '저도', '저', '요즘', '하는데', '할건데', '있나요', '없나요',
  '인데', '인데요', '쓰면', '쓸', '써야', '빌려야', '대여해야', '대여', '렌탈', '빌릴', '빌리', '이거', '그거', '이것', '그것', '이건', '그건', '저거',
  '그리고', '그런데', '근데', '그래서', '이번', '이번에', '정도', '같은', '관련', '위해', '위한', '대한', '가장', '제일', '잘', '많이',
])

export interface RecommendQuery {
  /** 공백으로 이은 검색어(없으면 빈 문자열) */
  query: string
  tokens: string[]
}

/** 질문에서 상품 검색에 쓸 핵심 단어만 뽑는다 */
export function extractRecommendQuery(message: string): RecommendQuery {
  const cleaned = message.toLowerCase().replace(/[?!.,~·()[\]{}"'“”‘’]/g, ' ')
  const tokens: string[] = []
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue
    const t = stripTrailingParticle(raw)
    if (t.length < 2 || /^\d+$/.test(t) || FILLER_TOKENS.has(t) || FILLER_TOKENS.has(raw) || STRIP_PREFIX_RE.test(t)) continue
    if (!tokens.includes(t)) tokens.push(t)
  }
  return { query: tokens.join(' '), tokens }
}

// ── 동의어 변형 검색어 (2026-10-08) ──────────────────────────────────────────────
// expandQueryWithConfirmedSynonyms는 "검색어 전체"가 동의어와 정확히 일치할 때만 확장한다.
// 추천 질문은 "소니 카메라"처럼 여러 단어라서, 단어 하나씩 동의어로 바꾼 변형 검색어("sony 카메라")를 만든다.
// 확정(confirmed)된 동의어만 쓰고(그룹은 호출부가 로드), 원문 검색어는 항상 가중치 1로 그대로 남는다.
export const SYNONYM_VARIANT_WEIGHT = 0.9
export const MAX_SYNONYM_VARIANTS = 6

export interface RecommendSearchTerm {
  q: string
  weight: number
  /** 동의어 변형이면 true(원문은 false) */
  expanded: boolean
}

export function buildRecommendSearchTerms(
  query: string,
  tokens: readonly string[],
  groups: readonly SynonymGroup[],
): RecommendSearchTerm[] {
  if (!query) return []
  const terms: RecommendSearchTerm[] = [{ q: query, weight: 1, expanded: false }]
  if (groups.length === 0) return terms

  const seen = new Set<string>([query.toLowerCase()])
  let variantCount = 0
  const push = (q: string): void => {
    const cleaned = q.trim()
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key) || variantCount >= MAX_SYNONYM_VARIANTS) return
    seen.add(key)
    variantCount++
    terms.push({ q: cleaned, weight: SYNONYM_VARIANT_WEIGHT, expanded: true })
  }

  const mutableGroups = [...groups]
  // ① 검색어 전체가 동의어와 일치하는 경우
  for (const syn of expandQueryWithConfirmedSynonyms(query, mutableGroups)) push(syn)
  // ② 단어 하나만 동의어로 바꾼 변형(나머지 단어는 그대로 유지)
  tokens.forEach((token, i) => {
    for (const syn of expandQueryWithConfirmedSynonyms(token, mutableGroups)) {
      push(tokens.map((t, j) => (j === i ? syn : t)).join(' '))
    }
  })
  return terms
}

export interface RecommendHit { id: string; score: number }
/**
 * 재보정용 관찰 메트릭: 카드 발송 여부와 무관하게 상위 3개 후보의 점수·상품 id를 남긴다
 * (하한 미달로 탈락한 "아깝게 놓친" 후보도 포함). 숫자와 상품 id뿐 — 검색어·고객 문장은 담지 않는다.
 */
export function buildRecommendMetrics(hits: readonly RecommendHit[], minScoreUsed: number, expanded: boolean): RecommendObservationMetrics {
  const top = [...hits].sort((a, b) => b.score - a.score).slice(0, 3)
  const round = (n: number): number => Math.round(n * 1000) / 1000
  return {
    top_score: top.length > 0 ? round(top[0].score) : null,
    card_scores: top.length > 0 ? top.map((h) => round(h.score)) : null,
    product_ids: top.length > 0 ? top.map((h) => h.id) : null,
    min_score_used: minScoreUsed,
    expanded,
  }
}

export interface RecommendProductRow {
  id: string
  name: string
  slug: string
  image_urls: string[] | null
  sale_only: boolean | null
  is_active?: boolean | null
  option_only?: boolean | null
  deleted_at?: string | null
}

export interface RecommendCard {
  type: 'PRODUCT_CARD'
  is_expired: false
  product_id: string
  product_name: string
  product_price: number
  product_image?: string
  action_url: string
}

/**
 * 검색 결과(점수순)와 DB 행·대여가격으로 카드 후보를 만든다.
 * 제외: 행이 없거나(삭제/비노출) 판매전용·옵션전용, 대여가격이 없는 상품. 점수는 1등 대비 minRatio 이상만.
 */
export function pickRecommendCards(
  hits: readonly RecommendHit[],
  rows: readonly RecommendProductRow[],
  prices: Readonly<Record<string, number>>,
  opts: { max?: number; minScore?: number; minRatio?: number } = {},
): RecommendCard[] {
  const max = opts.max ?? MAX_RECOMMEND_CARDS
  const minScore = opts.minScore ?? 0
  const minRatio = opts.minRatio ?? 0.35
  const byId = new Map(rows.map((r) => [r.id, r]))
  const sorted = [...hits].sort((a, b) => b.score - a.score)
  const top = sorted[0]?.score ?? 0
  const out: RecommendCard[] = []
  const seen = new Set<string>()
  for (const h of sorted) {
    if (out.length >= max) break
    if (seen.has(h.id) || h.score < minScore || h.score < top * minRatio) continue
    const r = byId.get(h.id)
    if (!r || !r.slug) continue
    if (r.sale_only === true || r.option_only === true || r.is_active === false || r.deleted_at) continue
    const price = prices[h.id]
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    seen.add(h.id)
    out.push({
      type: 'PRODUCT_CARD', is_expired: false, product_id: r.id, product_name: r.name, product_price: price,
      ...(r.image_urls?.[0] ? { product_image: r.image_urls[0] } : {}),
      action_url: `/products/${r.slug}`,
    })
  }
  return out
}

export const RECOMMEND_REPLY = {
  // 카드 수는 문구에 넣지 않는다(일부 저장 실패 시 안내와 실제 카드 수가 어긋나지 않도록)
  intro: '질문과 관련된 대여 상품을 찾아 보았어요. 카드를 눌러 상세 정보와 대여 가능 날짜를 확인해 보세요.',
  needDetail:
    '어떤 촬영에 쓰실지(예: 브이로그, 행사, 인터뷰)와 원하는 종류(카메라, 렌즈, 조명 등)를 알려 주시면 맞는 상품을 찾아 드릴게요.',
} as const
