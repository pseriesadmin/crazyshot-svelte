/**
 * adapters/productSearchIndex.ts — 상품 자연어 검색 어댑터 (서버 전용)
 *
 * crazyshot 전용 코드: products 테이블(부모 상품)을 조회해 core가 이해하는 SearchDocument[]로
 * 변환하고 MiniSearch 인덱스를 생성한다.
 *
 * 특징:
 * - 부모 상품만 대상 (parent_product_id IS NULL, is_active=true, deleted_at IS NULL)
 * - 모듈 스코프 캐시 (TTL 60초) — Vercel Serverless 콜드스타트 시 즉시 재구축
 * - keywords(TEXT[]), product_caption, content_blocks(JSONB → 텍스트 추출) 포함
 * - H-1(2026-08-07): components·specifications(JSONB key-value) 색인 추가 — boost 3(keywords_text 동급)
 * - `description` 컬럼은 products.md §2-10⑤에 따라 영구 미사용(항상 NULL) — 제외
 * - J-2(2026-08-07): product_search_stats 학습 기반 키워드 자동승격 — promote_threshold 이상 클릭된
 *   (product_id, search_term) 쌍을 색인 키워드에 추가 (TTL 60초 캐시 패턴 재사용)
 *
 * ⚠️ 이 파일은 crazyshot 전용 import 포함 가능 (adapters/ 계층)
 */

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { supabase } from '$lib/services/supabase'
import { createIndex } from '../core/createIndex'
import type { NaturalSearchProvider, SearchDocument } from '../core/types'

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
}

// ── 인덱스 설정 ───────────────────────────────────────────────────────────────

const PRODUCT_INDEX_CONFIG = {
  searchFields: [
    'name', 'brand', 'caption', 'keywords_text',
    'content_text', 'category',
    'components_text', 'specs_text',  // H-1: 구성품·사양 추가
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
  if (!jsonb || typeof jsonb !== 'object' || Array.isArray(jsonb)) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(jsonb as Record<string, unknown>)) {
    if (key) parts.push(key)
    if (value !== null && value !== undefined) parts.push(String(value))
  }
  return parts.join(' ').trim()
}

// ── 모듈 스코프 캐시 (TTL 60초) ──────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

let cachedIndex: NaturalSearchProvider<ProductDoc> | null = null
let cachedAt = 0

function isCacheValid(): boolean {
  return cachedIndex !== null && Date.now() - cachedAt < CACHE_TTL_MS
}

// ── J-2: 학습 설정 캐시 (promote_threshold, TTL 60초) ────────────────────────
// search_learning_settings는 RLS 미설정(service_role 전용) → admin 클라이언트 필수

const FALLBACK_PROMOTE_THRESHOLD = 3
const LEARN_SETTINGS_CACHE_TTL_MS = 60_000

let cachedPromoteThreshold: number | null = null
let promoteThresholdCachedAt = 0

async function loadPromoteThreshold(): Promise<number> {
  if (
    cachedPromoteThreshold !== null &&
    Date.now() - promoteThresholdCachedAt < LEARN_SETTINGS_CACHE_TTL_MS
  ) {
    return cachedPromoteThreshold
  }
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin
      .from('search_learning_settings')
      .select('promote_threshold')
      .limit(1)
      .maybeSingle()
    if (error || !data) return FALLBACK_PROMOTE_THRESHOLD
    const threshold =
      typeof data.promote_threshold === 'number'
        ? data.promote_threshold
        : FALLBACK_PROMOTE_THRESHOLD
    cachedPromoteThreshold = threshold
    promoteThresholdCachedAt = Date.now()
    return threshold
  } catch {
    return FALLBACK_PROMOTE_THRESHOLD
  }
}

// ── J-2: 학습된 검색어 로드 (product_search_stats, anon 조회 가능) ──────────
// pss_read_all 정책: anon·authenticated 모두 SELECT 허용
// 인덱스 재구축 시마다 호출 — 인덱스 TTL과 수명 공유
async function loadLearnedSearchTerms(
  promoteThreshold: number,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('product_search_stats')
    .select('product_id, search_term')
    .gte('click_count', promoteThreshold)
  if (error || !data) {
    console.error('[productSearchIndex] 학습 검색어 조회 실패:', error?.message)
    return new Map()
  }
  const map = new Map<string, string[]>()
  for (const row of data as { product_id: string; search_term: string }[]) {
    const pid = String(row.product_id)
    const existing = map.get(pid) ?? []
    existing.push(String(row.search_term))
    map.set(pid, existing)
  }
  return map
}

// ── 내보내기 함수 ─────────────────────────────────────────────────────────────

/**
 * 부모 상품 전체를 조회해 MiniSearch 인덱스를 빌드합니다.
 * TTL 내 재호출은 캐시 재사용, 만료 시 재구축.
 *
 * J-2: 인덱스 빌드 시 product_search_stats에서 학습된 검색어를 가져와
 * 각 상품의 keywords_text에 병합 (promote_threshold 이상 클릭된 search_term만).
 *
 * @returns 즉시 search() 호출 가능한 NaturalSearchProvider
 */
export async function getProductSearchIndex(): Promise<NaturalSearchProvider<ProductDoc>> {
  if (isCacheValid()) return cachedIndex!

  // J-2: 상품 조회와 promote_threshold 조회를 병렬 실행
  const [productResult, promoteThreshold] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, name, brand, category, slug, product_caption, keywords, content_blocks, components, specifications',
      )
      .is('parent_product_id', null)
      .eq('is_active', true)
      .is('deleted_at', null),
    loadPromoteThreshold(),
  ])

  const { data, error } = productResult

  if (error || !data) {
    // 조회 실패 시 빈 인덱스 반환 (검색 없이 RPC 결과만 사용하는 폴백)
    console.error('[productSearchIndex] 상품 조회 실패:', error?.message)
    return createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, [])
  }

  // J-2: 학습된 검색어 로드 (product_search_stats, anon client)
  const learnedTerms = await loadLearnedSearchTerms(promoteThreshold)

  const docs: ProductDoc[] = (data as Record<string, unknown>[]).map((row) => {
    const productId = String(row['id'] ?? '')
    const baseKeywords = Array.isArray(row['keywords'])
      ? (row['keywords'] as string[]).join(' ')
      : ''
    // J-2: 학습된 검색어를 keywords_text에 병합 (중복 제거 없이 빈도 강조)
    const learned = learnedTerms.get(productId) ?? []
    const keywords_text = [baseKeywords, ...learned].filter(Boolean).join(' ')

    return {
      id: productId,
      name: String(row['name'] ?? ''),
      brand: String(row['brand'] ?? ''),
      category: String(row['category'] ?? ''),
      slug: String(row['slug'] ?? ''),
      caption: String(row['product_caption'] ?? ''),
      keywords_text,
      content_text: extractContentBlocksText(row['content_blocks']),
      components_text: extractJsonbKeyValues(row['components']), // H-1: 구성품
      specs_text: extractJsonbKeyValues(row['specifications']), // H-1: 사양
    }
  })

  cachedIndex = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)
  cachedAt = Date.now()
  return cachedIndex
}

/**
 * 캐시를 강제 무효화합니다 (테스트 또는 수동 갱신 시 사용).
 * J-2: promote_threshold 캐시도 함께 초기화.
 */
export function invalidateProductSearchCache(): void {
  cachedIndex = null
  cachedAt = 0
  cachedPromoteThreshold = null
  promoteThresholdCachedAt = 0
}
