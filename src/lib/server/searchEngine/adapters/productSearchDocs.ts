/**
 * adapters/productSearchDocs.ts — 상품 검색 인덱스의 순수 로직 (환경변수·DB 접근 없음)
 *
 * productSearchIndex.ts(DB 조회·캐시)에서 분리한 순수 부분이다. 분리 이유: ① CI 단위 테스트가 실제 설정·문서 변환을
 * 그대로 검증할 수 있게(과거 productSearchLogic.test.ts는 설정 사본으로 검증해 설정이 어긋나도 못 잡았다)
 * ② `$env`를 import하지 않아 어디서든 가져다 쓸 수 있게.
 *
 * 포함: 인덱스 설정(PRODUCT_INDEX_CONFIG) · 문서 변환(buildProductDocs) · 후기 텍스트 맵 · 붙여 쓴 말의 끝말 분해 ·
 *       분류 이름 맵 · 분류 의도 판정과 분류 우선 정렬(크레이지챗 추천 전용 검색 메서드).
 *
 * L-2(2026-10-08, Stephen 승인): 한글 분류어 검색 품질 개선 — nlsearch.md §4-8
 *  ① compound_heads: 상품 키워드가 `캐논카메라 DSLR카메라`처럼 붙여 쓰여 있으면 "카메라" 접두 검색에 안 잡히던 문제 →
 *     사전 단어로 끝나는 붙임말의 "끝말"만 별도 칸에 넣는다(앞말은 넣지 않아 `카메라삼각대`가 카메라 점수를 받지 않는다).
 *  ② category_label: 분류가 영문 코드(camera·lens…)로만 저장돼 "카메라/렌즈"라는 한글 분류어가 색인에 없던 문제 →
 *     CMS 코드설정(code_mapping_groups)의 그룹 이름을 분류별로 읽어 새 칸에 넣는다(하드코딩 맵 없음).
 *  ③ 분류 우선 정렬: 질문 끝쪽의 연속된 단어가 분류 이름이면 그 분류 상품을 앞 구간에 둔다(기존 search()는 불변).
 * 기존 칸·기존 boost·토크나이저(core/)는 건드리지 않는다 — 새 칸을 "더하는" 방식이라 어떤 상품의 점수도 내려가지 않는다.
 */

import { stripTrailingParticle } from '../core/koreanTokenizer'
import type { NaturalSearchProvider, SearchDocument, SearchOptions, SearchResult } from '../core/types'

// ── 문서 타입 ────────────────────────────────────────────────────────────────

export interface ProductDoc extends SearchDocument {
  id: string
  name: string
  brand: string
  category: string
  slug: string
  /** product_caption (TEXT) */
  caption: string
  /** keywords TEXT[] → space-joined 문자열 */
  keywords_text: string
  /** content_blocks JSONB → 텍스트 노드만 추출, space-joined */
  content_text: string
  /** H-1: components JSONB(key-value) → "키 값" 형태 텍스트 */
  components_text: string
  /** H-1: specifications JSONB(key-value) → "키 값" 형태 텍스트 */
  specs_text: string
  /** L-1: 공개 후기 제목+본문 텍스트(상품당 최신 20개·2000자). 검색 전용 — 결과 객체에는 싣지 않음 */
  reviews_text: string
  /** L-2: 붙여 쓴 말의 끝말(캐논카메라→카메라). 검색 전용 — 결과 객체에는 싣지 않음 */
  compound_heads: string
  /** L-2: 한글 분류 이름(CMS 코드설정 그룹 이름, 예 "카메라"). 검색 전용 — 결과 객체에는 싣지 않음 */
  category_label: string
}

// ── 인덱스 설정 ───────────────────────────────────────────────────────────────

export const PRODUCT_INDEX_CONFIG = {
  searchFields: [
    'name', 'brand', 'caption', 'keywords_text',
    'content_text', 'category',
    'components_text', 'specs_text',  // H-1: 구성품·사양 추가
    'reviews_text',                   // L-1: 공개 후기 (가장 약한 가중치)
    'compound_heads',                 // L-2: 붙여 쓴 말의 끝말
    'category_label',                 // L-2: 한글 분류 이름
  ] as const,
  storeFields: ['id', 'name', 'brand', 'category', 'slug', 'caption', 'keywords_text'] as const,
  boost: {
    name: 5,
    brand: 3,
    caption: 3,
    keywords_text: 3,
    components_text: 3,  // H-1: keywords_text와 동급 — 구성품 이름/수량이 검색에서 중요
    specs_text: 3,       // H-1: keywords_text와 동급 — 사양 키워드(화소수, 배터리 등)
    content_text: 1,
    category: 1,
    reviews_text: 0.5,   // L-1: 상품명·키워드 일치가 항상 우선 — 후기는 보조 근거
    compound_heads: 2,   // L-2: 키워드(3)보다 약함 — 붙임말 끝말은 보조 신호
    category_label: 2,   // L-2: 분류 신호(키워드보다 약함). 평가 결과로 2~3 범위에서 확정
  },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

// ── HTML 태그 제거 (순수 텍스트 추출) ────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── content_blocks JSONB → 텍스트 추출 ───────────────────────────────────────

type ContentBlockRaw = {
  type: string
  html?: string
  content?: string
  text?: string
}

export function extractContentBlocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const textParts: string[] = []
  for (const block of blocks as ContentBlockRaw[]) {
    if (!block || typeof block !== 'object') continue
    // TextBlock: { type: 'text', html: '...' }
    if (block.type === 'text' && typeof block.html === 'string') {
      textParts.push(stripHtml(block.html))
    }
    // HtmlBlock: { type: 'html', content: '...' }
    if (block.type === 'html' && typeof block.content === 'string') {
      textParts.push(stripHtml(block.content))
    }
    // LinkEntryBlock: { type: 'link-entry', text: '...' }
    if (block.type === 'link-entry' && typeof block.text === 'string') {
      textParts.push(block.text)
    }
  }
  return textParts.join(' ').trim()
}

// ── JSONB key-value 객체 → "키 값" 텍스트 추출 (H-1) ────────────────────────
// components·specifications 컬럼 형식: {"배터리": "1개", "충전케이블": "1개"} 등
// 검색 시 "배터리", "1개", "배터리 1개" 등으로 매칭 가능하도록 변환
export function extractJsonbKeyValues(jsonb: unknown): string {
  if (Array.isArray(jsonb)) {
    // 2026-09-27: 순서 보존 배열 [{key,value}] 지원
    const parts: string[] = []
    for (const el of jsonb) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) continue
      const { key, value } = el as Record<string, unknown>
      if (key !== null && key !== undefined && String(key)) parts.push(String(key))
      if (value !== null && value !== undefined) parts.push(String(value))
    }
    return parts.join(' ').trim()
  }
  if (!jsonb || typeof jsonb !== 'object') return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(jsonb as Record<string, unknown>)) {
    if (key) parts.push(key)
    if (value !== null && value !== undefined) parts.push(String(value))
  }
  return parts.join(' ').trim()
}

// ── L-1: 후기 RPC 결과 → 상품별 후기 텍스트 맵 (순수 함수) ──────────────────
// get_product_review_search_texts(Migration 670) 응답 행: { product_id, review_count, review_text }
// · 배열이 아니거나 형식이 잘못된 행은 건너뛴다(검색을 막지 않는다)
// · 같은 product_id가 중복되면 텍스트를 공백으로 이어붙이고 건수를 합산한다
// · 상품당 텍스트는 MAX_REVIEW_CHARS_PER_PRODUCT(2000자)에서 절단한다

export const MAX_REVIEW_CHARS_PER_PRODUCT = 2000

export interface ReviewsTextEntry {
  text: string
  count: number
}

export function buildReviewsTextMap(rows: unknown): Map<string, ReviewsTextEntry> {
  const map = new Map<string, ReviewsTextEntry>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { product_id, review_text, review_count } = row as Record<string, unknown>
    if (typeof product_id !== 'string' || product_id === '') continue
    if (typeof review_text !== 'string') continue
    const text = review_text.trim()
    if (text === '') continue
    const count =
      typeof review_count === 'number' && Number.isFinite(review_count) && review_count > 0
        ? Math.floor(review_count)
        : 1
    const prev = map.get(product_id)
    const joined = prev ? `${prev.text} ${text}` : text
    map.set(product_id, {
      text: joined.slice(0, MAX_REVIEW_CHARS_PER_PRODUCT),
      count: (prev?.count ?? 0) + count,
    })
  }
  return map
}

// ── L-2: 붙여 쓴 말의 끝말 분해 ──────────────────────────────────────────────

/**
 * 끝말 후보 사전 — 상품 종류를 뜻하는 말. "OO카메라"처럼 이 말로 끝나는 붙임말에서 끝말만 뽑아 compound_heads에 넣는다.
 * 분류 이름(CMS 코드설정)은 호출부가 extraHeads로 함께 넘긴다. 새 종류가 필요하면 여기에 추가하고 테스트 표를 갱신한다.
 */
export const COMPOUND_HEAD_WORDS: readonly string[] = [
  '카메라', '렌즈', '삼각대', '모니터', '배터리', '마이크', '슬라이더', '캠코더', '조명', '짐벌', '드론',
  '어댑터', '마운트', '거치대', '셀카봉', '스트랩', '하네스', '필터', '케이블', '충전기', '프롬프터', '스탠드', '후드',
  '액션캠', '미러리스',
]

function normalizeHeads(extra: readonly string[]): string[] {
  const set = new Set<string>()
  for (const w of [...COMPOUND_HEAD_WORDS, ...extra]) {
    const t = w.trim().toLowerCase()
    if (t.length >= 2) set.add(t)
  }
  // 긴 말부터 시도(짧은 말이 먼저 걸려 잘못 자르는 것 방지)
  return [...set].sort((a, b) => b.length - a.length)
}

/**
 * 텍스트의 각 단어가 사전 단어로 "끝나는 붙임말"이면 그 끝말만 모아 돌려준다(중복 제거).
 *  · 사전 단어와 똑같은 단어는 대상이 아니다(이미 단독으로 색인된다)
 *  · 단어는 조사를 뗀 뒤 3자 이상이고, 끝말 앞에 1자 이상 앞말이 있어야 한다
 *  · 앞말은 결과에 넣지 않는다 — "카메라삼각대"가 "카메라" 검색에서 추가 점수를 받으면 액세서리가 카메라 앞에 선다
 */
export function extractCompoundHeads(text: string, extraHeads: readonly string[] = []): string[] {
  if (!text) return []
  const heads = normalizeHeads(extraHeads)
  const out = new Set<string>()
  for (const raw of text.split(/[\s,.!?~·/\-_()+[\]]+/)) {
    if (!raw) continue
    const token = stripTrailingParticle(raw.toLowerCase())
    if (token.length < 3) continue
    for (const h of heads) {
      if (token === h) break // eslint-disable-line security/detect-possible-timing-attacks
      if (token.endsWith(h)) {
        out.add(h)
        break
      }
    }
  }
  return [...out]
}

// ── L-2: 분류 이름 맵 (code_mapping_groups → 분류 코드별 한글 이름) ───────────

/** code_mapping_groups 행({default_category, name}) → 분류 코드별 이름 목록. 비정상 행은 건너뛴다. */
export function buildCategoryLabelMap(rows: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { default_category, name } = row as Record<string, unknown>
    if (typeof default_category !== 'string' || typeof name !== 'string') continue
    const code = default_category.trim()
    const label = name.trim()
    if (code === '' || label === '') continue
    const list = map.get(code) ?? []
    if (!list.includes(label)) list.push(label)
    map.set(code, list)
  }
  return map
}

/** "드론/짐벌" 같은 이름은 부분("드론", "짐벌")으로도 쓴다 */
function labelParts(label: string): string[] {
  return label.split(/[/\s]+/).map((p) => p.trim()).filter((p) => p.length >= 1)
}

// ── 문서 변환 ────────────────────────────────────────────────────────────────

export interface ProductDocContext {
  /** J-2: 고객 클릭 학습 키워드 (product_id → search_term[]) */
  learnedTerms?: ReadonlyMap<string, string[]>
  /** I-4: 관리자 확인 신호 (product_id → search_term[]) */
  adminConfirmedTerms?: ReadonlyMap<string, string[]>
  /** L-1: 공개 후기 텍스트 */
  reviewTexts?: ReadonlyMap<string, ReviewsTextEntry>
  /** L-2: 분류 코드 → 한글 이름 목록(CMS 코드설정). 비면 기존과 같은 문서가 된다 */
  categoryLabels?: ReadonlyMap<string, string[]>
}

/** products 행 배열 → 검색 문서 배열 (순수 함수) */
export function buildProductDocs(rows: readonly Record<string, unknown>[], ctx: ProductDocContext = {}): ProductDoc[] {
  const labels = ctx.categoryLabels ?? new Map<string, string[]>()
  // 모든 분류 이름의 부분 단어를 끝말 사전에 함께 쓴다
  const labelHeads: string[] = []
  for (const names of labels.values()) for (const n of names) labelHeads.push(...labelParts(n))

  return rows.map((row) => {
    const productId = String(row['id'] ?? '')
    const baseKeywords = Array.isArray(row['keywords']) ? (row['keywords'] as string[]).join(' ') : ''
    // J-2 + I-4: 고객 학습 키워드 + 관리자 확인 신호를 같은 병합 라인에서 join
    const learned = ctx.learnedTerms?.get(productId) ?? []
    const adminConfirmed = ctx.adminConfirmedTerms?.get(productId) ?? []
    const keywords_text = [baseKeywords, ...learned, ...adminConfirmed].filter(Boolean).join(' ')
    const name = String(row['name'] ?? '')
    const caption = String(row['product_caption'] ?? '')
    const category = String(row['category'] ?? '')

    return {
      id: productId,
      name,
      brand: String(row['brand'] ?? ''),
      category,
      slug: String(row['slug'] ?? ''),
      caption,
      keywords_text,
      content_text: extractContentBlocksText(row['content_blocks']),
      components_text: extractJsonbKeyValues(row['components']), // H-1: 구성품
      specs_text: extractJsonbKeyValues(row['specifications']), // H-1: 사양
      reviews_text: ctx.reviewTexts?.get(productId)?.text ?? '', // L-1: 공개 후기(보조 근거)
      compound_heads: extractCompoundHeads([name, caption, keywords_text].join(' '), labelHeads).join(' '), // L-2
      category_label: (labels.get(category) ?? []).join(' '), // L-2
    }
  })
}

// ── L-2: 분류 의도 판정 · 분류 우선 정렬 ─────────────────────────────────────

/** 질문 끝에 붙는 부탁 표현 — 분류 이름 판정에서 무시한다(예: "카메라 렌즈 줘요") */
const TRAILING_REQUEST_WORDS: ReadonlySet<string> = new Set([
  '줘요', '줘', '주세요', '주라', '해줘', '해줘요', '알려줘', '알려줘요', '알려주세요', '부탁', '부탁해', '부탁해요', '좀',
  '추천', '추천해', '추천해요', '추천해줘', '추천해줘요', '추천해주세요',
])

/**
 * 질문 끝쪽의 "연속된 단어"가 분류 이름이면 그 분류 코드 목록을 돌려준다. 아니면 null.
 *  · "소니 카메라" → [camera] / "카메라 렌즈" → [camera, lens] / "카메라 가방" → null(끝말이 분류 이름이 아님)
 *  · 분류 이름 맵이 비어 있으면(조회 실패) 항상 null → 기존 검색과 같다
 */
export function detectCategoryIntent(query: string, labels: ReadonlyMap<string, string[]>): string[] | null {
  if (!query || labels.size === 0) return null
  const byLabel = new Map<string, Set<string>>()
  const addLabel = (key: string, code: string): void => {
    const k = key.trim().toLowerCase()
    if (!k) return
    const set = byLabel.get(k) ?? new Set<string>()
    set.add(code)
    byLabel.set(k, set)
  }
  for (const [code, names] of labels) {
    for (const n of names) {
      addLabel(n, code)
      for (const p of labelParts(n)) addLabel(p, code)
    }
  }

  const tokens = query.trim().split(/[\s,]+/).map((t) => t.replace(/[?!.~]+$/g, '')).filter(Boolean)
  while (tokens.length > 0 && TRAILING_REQUEST_WORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop()

  const codes = new Set<string>()
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = stripTrailingParticle(tokens[i].toLowerCase()) // eslint-disable-line security/detect-object-injection
    const hit = byLabel.get(t) ?? byLabel.get(tokens[i].toLowerCase()) // eslint-disable-line security/detect-object-injection
    if (!hit) break
    for (const c of hit) codes.add(c)
  }
  return codes.size > 0 ? [...codes] : null
}

interface ScoredByCategory {
  score: number
  document: Record<string, unknown>
}

/**
 * 분류 일치 상품을 앞 구간에 두고, 나머지의 점수를 일치 구간 최저점 아래로 압축한다(상대 순서 유지).
 * 점수를 보정하는 이유: 추천 카드 선택(pickRecommendCards)이 점수순·1위 대비 비율로 고르므로 순서만 바꾸면 효과가 없다.
 * 일치 상품이 없거나 전부 일치하면 그대로 돌려준다 → 일치가 3개 미만이면 나머지가 채워 결과가 비지 않는다.
 */
export function reorderByCategoryIntent<R extends ScoredByCategory>(results: readonly R[], categories: readonly string[]): R[] {
  if (categories.length === 0) return [...results]
  const set = new Set(categories)
  const inGroup = results.filter((r) => set.has(String(r.document.category))).sort((a, b) => b.score - a.score)
  const rest = results.filter((r) => !set.has(String(r.document.category))).sort((a, b) => b.score - a.score)
  if (inGroup.length === 0 || rest.length === 0) return [...results]
  const minIn = inGroup[inGroup.length - 1].score
  const maxRest = rest[0].score
  // 점수가 0 이하이면 곱셈 압축이 순서를 뒤집을 수 있어 구간만 나누고 점수는 그대로 둔다(MiniSearch 점수는 항상 양수 — 방어용)
  if (minIn <= 0 || maxRest <= 0 || maxRest < minIn) return [...inGroup, ...rest]
  const factor = (minIn * 0.99) / maxRest
  return [...inGroup, ...rest.map((r) => ({ ...r, score: r.score * factor }))]
}

/**
 * 분류 우선 검색 메서드를 만든다 — 기존 provider.search()는 그대로 두고, 분류 이름으로 끝나는 질의에만 재정렬한다.
 * 분류 일치 상품이 limit 밖으로 밀려 있을 수 있어 재정렬 전에 넉넉히(300개) 가져온다.
 */
export function createCategoryIntentSearch<T extends SearchDocument>(
  provider: NaturalSearchProvider<T>,
  labels: ReadonlyMap<string, string[]>,
): (query: string, opts?: SearchOptions) => SearchResult<T>[] {
  return (query, opts) => {
    const categories = detectCategoryIntent(query, labels)
    if (!categories) return provider.search(query, opts)
    const limit = opts?.limit ?? 20
    const raw = provider.search(query, { ...opts, limit: Math.max(limit, 300) })
    return reorderByCategoryIntent(raw, categories).slice(0, limit)
  }
}
