// 검색 클릭 이벤트 기록 + 자동완성 유틸
// AI 학습 피드백 루프: 클릭 → product_search_stats CTR 갱신 → 다음 검색 랭킹 반영
// 클라이언트 컴포넌트에서 import 가능 (anon 클라이언트 사용)

import { supabase } from '$lib/services/supabase'

export interface SearchResult {
  product_id: string
  name: string
  slug: string
  category: string
  brand: string | null
  price_min: number | null
  image_url: string | null
  rank_score: number
  total_count: number
}

export interface TopSearchTerm {
  normalized_term: string
  search_count: number
  avg_result_count: number
}

// 상품 클릭 이벤트 기록 (AI 학습 피드백 루프)
export async function recordSearchClick(searchLogId: string, productId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('record_search_click', {
    p_search_log_id: searchLogId,
    p_product_id:    productId,
  })
  // 실패 무시 — 검색 UX에 영향 없음
}

// 인기 검색어 Top N (자동완성용 — Materialized View 조회)
export async function getTopSearchTerms(limit = 10): Promise<TopSearchTerm[]> {
  const { data } = await supabase
    .from('mv_top_search_terms')
    .select('normalized_term, search_count, avg_result_count')
    .order('search_count', { ascending: false })
    .limit(limit)
  return (data ?? []) as TopSearchTerm[]
}

// 유사 검색어 (오타 교정용 — trgm 기반)
export async function getSimilarSearchTerms(query: string, limit = 5): Promise<string[]> {
  const { data } = await supabase
    .from('mv_top_search_terms')
    .select('normalized_term')
    .ilike('normalized_term', `%${query.slice(0, 3)}%`)
    .order('search_count', { ascending: false })
    .limit(limit)
  return (data ?? []).map((d: { normalized_term: string }) => d.normalized_term)
}
