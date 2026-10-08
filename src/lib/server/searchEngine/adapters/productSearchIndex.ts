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
 * - I-4(2026-08-26): cms_admin_product_search_confirmations 관리자 확인 신호 소비 — status='confirmed'인
 *   (product_id, search_term)을 J-2 학습 키워드와 같은 라인에서 keywords_text에 병합
 *   (저장 분리 / 소비 시점 병합 — service-operations.md §14 원칙과 동일)
 * - L-1(2026-10-08): 공개 상품 후기(product_reviews) 텍스트 색인 합류 — 상품당 최신 20개·2000자, boost 0.5
 *   (이름·브랜드·키워드보다 항상 약함), 검색 결과 객체(storeFields)에는 싣지 않음. 작성자 정보는 조회하지 않는다.
 *   실패 시 빈 맵 폴백(검색 중단 금지). 인덱스 빌드 통계는 getLastIndexBuildStats()로 정기 점검 cron이 읽는다.
 * - L-2(2026-10-08): 한글 분류어 검색 품질 — 설정·문서 변환 등 순수 로직은 productSearchDocs.ts로 분리했다.
 *   새 검색 칸 compound_heads(붙임말 끝말)·category_label(CMS 코드설정 그룹 이름, 이 파일이 code_mapping_groups를 읽는다)을
 *   더했고, 반환 객체에 분류 우선 검색 메서드 searchWithCategoryIntent(크레이지챗 추천 전용)를 붙였다. 기존 search()는 불변.
 *
 * ⚠️ 이 파일은 crazyshot 전용 import 포함 가능 (adapters/ 계층)
 */

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { supabase } from '$lib/services/supabase'
import { createIndex } from '../core/createIndex'
import type { NaturalSearchProvider, SearchOptions, SearchResult } from '../core/types'
import {
  PRODUCT_INDEX_CONFIG,
  MAX_REVIEW_CHARS_PER_PRODUCT,
  buildCategoryLabelMap,
  buildProductDocs,
  buildReviewsTextMap,
  createCategoryIntentSearch,
  extractContentBlocksText,
  extractJsonbKeyValues,
  type ProductDoc,
  type ReviewsTextEntry,
} from './productSearchDocs'

// 기존 import 경로 호환: 순수 로직은 productSearchDocs.ts로 옮겼지만 이 파일에서도 같은 이름으로 내보낸다
export {
  MAX_REVIEW_CHARS_PER_PRODUCT,
  buildReviewsTextMap,
  extractContentBlocksText,
  extractJsonbKeyValues,
}
export type { ProductDoc, ReviewsTextEntry }

/** getProductSearchIndex()가 돌려주는 검색 객체 — 기존 search()에 분류 우선 검색(크레이지챗 추천 전용)을 더한 형태 */
export type ProductSearchProvider = NaturalSearchProvider<ProductDoc> & {
  searchWithCategoryIntent: (query: string, opts?: SearchOptions) => SearchResult<ProductDoc>[]
}

// ── 모듈 스코프 캐시 (TTL 60초) ──────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

let cachedIndex: ProductSearchProvider | null = null
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

// ── I-4: 관리자 확인 신호 로드 (cms_admin_product_search_confirmations) ─────────
// service_role 전용 → admin 클라이언트 필수 (RLS 정책 없음)
// J-2 loadLearnedSearchTerms()와 완전히 동일한 패턴 재사용
async function loadAdminConfirmedSearchTerms(): Promise<Map<string, string[]>> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin
      .from('cms_admin_product_search_confirmations')
      .select('product_id, search_term')
      .eq('status', 'confirmed')
    if (error || !data) {
      console.error('[productSearchIndex] 관리자 확인 신호 조회 실패:', error?.message)
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
  } catch {
    return new Map()
  }
}

// ── L-1: 공개 후기 텍스트 로드 (get_product_review_search_texts, service_role 전용 RPC) ──
// 작성자 정보(user_id·author_name)는 RPC가 반환하지 않는다. 실패 시 빈 맵(검색 중단 금지, EC-3).
async function loadReviewSearchTerms(): Promise<Map<string, ReviewsTextEntry>> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin.rpc('get_product_review_search_texts', {
      p_per_product: 20,
      p_max_chars: MAX_REVIEW_CHARS_PER_PRODUCT,
    })
    if (error) {
      console.error('[productSearchIndex] 후기 텍스트 조회 실패:', error.message)
      return new Map()
    }
    return buildReviewsTextMap(data)
  } catch (e) {
    console.error('[productSearchIndex] 후기 텍스트 조회 오류:', e instanceof Error ? e.message : String(e))
    return new Map()
  }
}

// ── L-2: 한글 분류 이름 로드 (code_mapping_groups: name ↔ default_category, service_role 전용) ──
// 정본은 CMS 코드설정의 그룹 이름이다(/cms/products 목록도 같은 값을 쓴다). 하드코딩 맵 없음.
// 실패 시 빈 맵(검색 중단 금지) → 분류 이름 칸이 비고 분류 우선 정렬이 꺼져 기존과 같은 결과가 된다.
// ⚠ CMS에서 그룹 이름을 바꾸면 인덱스 TTL(60초) 뒤 반영된다.
async function loadCategoryLabels(): Promise<Map<string, string[]>> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin
      .from('code_mapping_groups')
      .select('name, default_category')
      .not('default_category', 'is', null)
    if (error) {
      console.error('[productSearchIndex] 분류 이름 조회 실패:', error.message)
      return new Map()
    }
    return buildCategoryLabelMap(data)
  } catch (e) {
    console.error('[productSearchIndex] 분류 이름 조회 오류:', e instanceof Error ? e.message : String(e))
    return new Map()
  }
}

/** 인덱스에 분류 우선 검색 메서드를 붙인다(기존 search()는 그대로) */
function withCategoryIntent(
  index: NaturalSearchProvider<ProductDoc>,
  labels: ReadonlyMap<string, string[]>,
): ProductSearchProvider {
  return Object.assign(index, { searchWithCategoryIntent: createCategoryIntentSearch(index, labels) })
}

// ── L-1: 인덱스 빌드 통계 (정기 점검 cron이 읽음 — 숫자만, 상품명·후기 문구 없음) ──

export interface IndexBuildStats {
  indexedProducts: number
  reviewedProducts: number
  reviewRows: number
  weakProducts: number
  buildMs: number
  status: 'ok' | 'error'
  builtAt: number
}

let lastBuildStats: IndexBuildStats | null = null

export function getLastIndexBuildStats(): IndexBuildStats | null {
  return lastBuildStats
}

// ── 내보내기 함수 ─────────────────────────────────────────────────────────────

/**
 * 부모 상품 전체를 조회해 MiniSearch 인덱스를 빌드합니다.
 * TTL 내 재호출은 캐시 재사용, 만료 시 재구축.
 *
 * J-2: 인덱스 빌드 시 product_search_stats에서 학습된 검색어를 가져와
 * 각 상품의 keywords_text에 병합 (promote_threshold 이상 클릭된 search_term만).
 *
 * I-4: cms_admin_product_search_confirmations에서 status='confirmed'인 신호를 함께 로드해
 * 동일 keywords_text 병합 라인에서 J-2 학습 키워드와 합산(저장 분리 / 소비 시점 병합).
 *
 * L-2: 한글 분류 이름(code_mapping_groups)을 함께 읽어 category_label 칸과 분류 우선 검색(searchWithCategoryIntent)에 쓴다.
 *
 * @returns 즉시 search() 호출 가능한 검색 객체(+ 분류 우선 검색 메서드)
 */
export async function getProductSearchIndex(): Promise<ProductSearchProvider> {
  if (isCacheValid()) return cachedIndex!

  const buildStartedAt = Date.now()

  // J-2 + I-4 + L-1 + L-2: 상품 조회 · promote_threshold · 관리자 확인 신호 · 공개 후기 · 분류 이름을 병렬 실행
  const [productResult, promoteThreshold, adminConfirmedTerms, reviewTexts, categoryLabels] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, name, brand, category, slug, product_caption, keywords, content_blocks, components, specifications',
      )
      .is('parent_product_id', null)
      .eq('is_active', true)
      .eq('option_only', false)
      .is('deleted_at', null),
    loadPromoteThreshold(),
    loadAdminConfirmedSearchTerms(),   // I-4: 관리자 확인 신호 (fail-safe: 실패 시 빈 맵)
    loadReviewSearchTerms(),           // L-1: 공개 후기 텍스트 (fail-safe: 실패 시 빈 맵)
    loadCategoryLabels(),              // L-2: 한글 분류 이름 (fail-safe: 실패 시 빈 맵)
  ])

  const { data, error } = productResult

  if (error || !data) {
    // 조회 실패 시 빈 인덱스 반환 (검색 없이 RPC 결과만 사용하는 폴백)
    console.error('[productSearchIndex] 상품 조회 실패:', error?.message)
    lastBuildStats = {
      indexedProducts: 0, reviewedProducts: 0, reviewRows: 0, weakProducts: 0,
      buildMs: Date.now() - buildStartedAt, status: 'error', builtAt: Date.now(),
    }
    return withCategoryIntent(createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, []), new Map())
  }

  // J-2: 학습된 검색어 로드 (product_search_stats, anon client)
  const learnedTerms = await loadLearnedSearchTerms(promoteThreshold)

  // 문서 변환은 순수 모듈(productSearchDocs.buildProductDocs)이 한다 — J-2 학습·I-4 관리자 확인·L-1 후기·L-2 분류 이름 병합
  const docs: ProductDoc[] = buildProductDocs(data as Record<string, unknown>[], {
    learnedTerms,
    adminConfirmedTerms,
    reviewTexts,
    categoryLabels,
  })

  cachedIndex = withCategoryIntent(createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs), categoryLabels)
  cachedAt = Date.now()

  // L-1: 정기 점검용 빌드 통계 (숫자만)
  let reviewedProducts = 0
  let reviewRows = 0
  let weakProducts = 0
  for (const d of docs) {
    const entry = reviewTexts.get(d.id)
    if (entry) {
      reviewedProducts++
      reviewRows += entry.count
    }
    if (d.keywords_text === '' && d.caption === '') weakProducts++
  }
  lastBuildStats = {
    indexedProducts: docs.length, reviewedProducts, reviewRows, weakProducts,
    buildMs: Date.now() - buildStartedAt, status: 'ok', builtAt: Date.now(),
  }
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
