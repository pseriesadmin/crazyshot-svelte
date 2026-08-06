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
 * - `description` 컬럼은 products.md §2-10⑤에 따라 영구 미사용(항상 NULL) — 제외
 *
 * ⚠️ 이 파일은 crazyshot 전용 import 포함 가능 (adapters/ 계층)
 */

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
}

// ── 인덱스 설정 ───────────────────────────────────────────────────────────────

const PRODUCT_INDEX_CONFIG = {
  searchFields: ['name', 'brand', 'caption', 'keywords_text', 'content_text', 'category'] as const,
  storeFields: ['id', 'name', 'brand', 'category', 'slug', 'caption', 'keywords_text'] as const,
  boost: {
    name: 5,
    brand: 3,
    caption: 3,
    keywords_text: 3,
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

function extractContentBlocksText(blocks: unknown): string {
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

// ── 모듈 스코프 캐시 (TTL 60초) ──────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

let cachedIndex: NaturalSearchProvider<ProductDoc> | null = null
let cachedAt = 0

function isCacheValid(): boolean {
  return cachedIndex !== null && Date.now() - cachedAt < CACHE_TTL_MS
}

// ── 내보내기 함수 ─────────────────────────────────────────────────────────────

/**
 * 부모 상품 전체를 조회해 MiniSearch 인덱스를 빌드합니다.
 * TTL 내 재호출은 캐시 재사용, 만료 시 재구축.
 *
 * @returns 즉시 search() 호출 가능한 NaturalSearchProvider
 */
export async function getProductSearchIndex(): Promise<NaturalSearchProvider<ProductDoc>> {
  if (isCacheValid()) return cachedIndex!

  // 부모 상품만 조회 (products.md §1 원칙)
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, category, slug, product_caption, keywords, content_blocks')
    .is('parent_product_id', null)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error || !data) {
    // 조회 실패 시 빈 인덱스 반환 (검색 없이 RPC 결과만 사용하는 폴백)
    console.error('[productSearchIndex] 상품 조회 실패:', error?.message)
    return createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, [])
  }

  const docs: ProductDoc[] = (data as Record<string, unknown>[]).map((row) => ({
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    brand: String(row['brand'] ?? ''),
    category: String(row['category'] ?? ''),
    slug: String(row['slug'] ?? ''),
    caption: String(row['product_caption'] ?? ''),
    keywords_text: Array.isArray(row['keywords'])
      ? (row['keywords'] as string[]).join(' ')
      : '',
    content_text: extractContentBlocksText(row['content_blocks']),
  }))

  cachedIndex = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)
  cachedAt = Date.now()
  return cachedIndex
}

/**
 * 캐시를 강제 무효화합니다 (테스트 또는 수동 갱신 시 사용).
 */
export function invalidateProductSearchCache(): void {
  cachedIndex = null
  cachedAt = 0
}
