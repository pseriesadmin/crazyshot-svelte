// popular.ts — 지식 저장소의 "최근 90일 인기 상품" 집계를 추천 카드 후보로 바꾼다 (서버 전용)
// 집계는 매일 새벽 정리 작업(crazychat_knowledge.reservation)이 만든다. 아직 없거나 건수가 적으면 빈 목록(→ 호출부가 되묻기로 이어감).
import type { AdminClient } from './shared'
import type { RecommendHit } from './recommend'
import { fetchCardData, type RecommendSearchResult } from './recommend-search'

/** 인기 상품으로 인정하는 최소 예약 건수(우연한 1건으로 인기 상품이 되지 않도록) */
export const POPULAR_MIN_COUNT = 2
const POPULAR_FETCH_LIMIT = 10

/** 예약 요약(JSON)에서 인기 상품 후보를 고른다. 형식이 이상하면 빈 목록 */
export function selectPopularHits(digest: unknown): RecommendHit[] {
  const list = (digest as { popularProducts?: unknown } | null)?.popularProducts
  if (!Array.isArray(list)) return []
  const hits: RecommendHit[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const { productId, count } = it as { productId?: unknown; count?: unknown }
    if (typeof productId !== 'string' || typeof count !== 'number' || count < POPULAR_MIN_COUNT) continue
    hits.push({ id: productId, score: count })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, POPULAR_FETCH_LIMIT)
}

export type PopularLoader = (admin: AdminClient) => Promise<RecommendSearchResult>

/** 기본 인기 상품 조회: 저장소 요약 → 후보 → 대여 가능한 부모 상품의 행·24시간 가격 */
export const defaultLoadPopular: PopularLoader = async (admin) => {
  const { data, error } = await admin.from('crazychat_knowledge').select('digest').eq('source', 'reservation').maybeSingle()
  if (error) throw new Error(error.message)
  const hits = selectPopularHits((data as { digest?: unknown } | null)?.digest)
  if (hits.length === 0) return { hits: [], rows: [], prices: {} }
  const { rows, prices } = await fetchCardData(admin, hits.map((h) => h.id))
  return { hits, rows, prices }
}
