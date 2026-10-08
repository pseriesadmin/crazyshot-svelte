// recommend-search.ts — 추천형 기본 상품 검색기(서버 전용). 기존 상품 자연어 검색 인덱스(MiniSearch)와 DB를 그대로 쓴다.
// 환경변수($env)를 쓰는 인덱스 모듈은 실제 호출 시점에만 불러온다(단위 테스트가 환경 없이 import 가능하도록).

import type { SynonymGroup } from '$lib/server/searchEngine/core/synonymExpander'
import type { AdminClient } from './shared'
import { buildRecommendSearchTerms, type RecommendHit, type RecommendProductRow } from './recommend'

export interface RecommendSearchResult {
  hits: RecommendHit[]
  rows: RecommendProductRow[]
  prices: Record<string, number>
  /** 동의어 변형 검색어가 실제로 사용됐는지(관찰 기록용) */
  usedExpansion?: boolean
}

export type RecommendSearcher = (admin: AdminClient, query: string, tokens: readonly string[]) => Promise<RecommendSearchResult>

/** 확정(confirmed) 동의어 그룹 로더 — 실패하거나 없으면 빈 배열(= 동의어 확장 없이 기존 동작) */
export type SynonymGroupLoader = () => Promise<readonly SynonymGroup[]>

// 환경변수($env)를 쓰는 모듈이라 실제 호출 시점에만 불러온다(단위 테스트가 환경 없이 import 가능하도록)
const loadConfirmedSynonymGroups: SynonymGroupLoader = async () => {
  try {
    const { loadSynonymGroups } = await import('$lib/server/synonymLearning')
    return await loadSynonymGroups()
  } catch {
    return []
  }
}

/** 카드 후보 id → 대여 가능한 부모 상품 행 + 24시간 대여가격. 판매전용·옵션전용·비노출·삭제 상품은 행에서 빠진다 */
export async function fetchCardData(admin: AdminClient, ids: readonly string[]): Promise<{ rows: RecommendProductRow[]; prices: Record<string, number> }> {
  if (ids.length === 0) return { rows: [], prices: {} }
  const { data: rowData, error: rowErr } = await admin
    .from('products')
    .select('id, name, slug, image_urls, sale_only, is_active, option_only, deleted_at')
    .in('id', ids)
    .is('parent_product_id', null)
    .is('deleted_at', null)
    .eq('is_active', true)
    .eq('sale_only', false)
    .eq('option_only', false)
  if (rowErr) throw new Error(rowErr.message)

  // 대여가격: 24시간(1일) 기준 가격만 쓴다 — 카드가 '원/일'로 표시하므로 12시간 요금은 쓰지 않는다(24시간 가격이 없는 상품은 카드 제외)
  const { data: priceData, error: priceErr } = await admin
    .from('price_rules')
    .select('product_id, duration_type, price')
    .in('product_id', ids)
    .eq('duration_type', '24h')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (priceErr) throw new Error(priceErr.message)
  const prices: Record<string, number> = {}
  for (const p of (priceData ?? []) as Array<{ product_id: string; duration_type: string; price: number }>) {
    if (Number(p.price) > 0 && prices[p.product_id] === undefined) prices[p.product_id] = Number(p.price)
  }
  return { rows: (rowData ?? []) as RecommendProductRow[], prices }
}

/** 동의어 그룹 로더를 바꿔 끼울 수 있는 추천 검색기 생성기(테스트·라이브 검증용). 기본 검색기는 아래 defaultRecommendSearcher */
export function createRecommendSearcher(loadGroups: SynonymGroupLoader = loadConfirmedSynonymGroups): RecommendSearcher {
  return async (admin, query, tokens) => {
    const { getProductSearchIndex } = await import('$lib/server/searchEngine/adapters/productSearchIndex')
    const index = await getProductSearchIndex()
    const merged = new Map<string, number>()
    // L-2: 질문 끝이 분류 이름이면("소니 카메라") 그 분류 상품을 앞 구간에 두는 검색을 쓴다(없으면 기존 search 그대로)
    const searchTerm = typeof index.searchWithCategoryIntent === 'function' ? index.searchWithCategoryIntent : index.search.bind(index)
    const add = (q: string, weight: number) => {
      for (const r of searchTerm(q, { fuzzy: 0.2, prefix: true, limit: 30 })) {
        const id = r.document.id
        merged.set(id, Math.max(merged.get(id) ?? 0, r.score * weight))
      }
    }
    // 원문(가중치 1) + 확정 동의어로 단어를 바꾼 변형(가중치 0.9). 동의어가 없으면 원문 1개뿐이라 기존 동작과 같다.
    const groups: readonly SynonymGroup[] = await loadGroups().catch(() => [])
    const terms = buildRecommendSearchTerms(query, tokens, groups)
    for (const t of terms) add(t.q, t.weight)
    const usedExpansion = terms.some((t) => t.expanded)
    // 전체 검색어로 결과가 부족하면 단어별로도 찾는다(약한 가중치)
    if (merged.size < 3 && tokens.length > 1) for (const t of tokens) add(t, 0.6)
    const hits: RecommendHit[] = [...merged.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, 15)
    if (hits.length === 0) return { hits: [], rows: [], prices: {}, usedExpansion }
    const { rows, prices } = await fetchCardData(admin, hits.map((h) => h.id))
    return { hits, rows, prices, usedExpansion }
  }
}

/** 기본 추천 검색기 — 확정 동의어 그룹을 DB에서 읽는다(60초 캐시, 실패 시 확장 없이 동작) */
export const defaultRecommendSearcher: RecommendSearcher = createRecommendSearcher()
