// GET /api/search/suggest?q=&limit=
// 검색창 자동완성 드롭다운 전용 경량 API (2026-10-06)
//
// /api/search/products와 달리 search_products RPC를 호출하지 않는다 — 그 RPC는 호출마다 search_logs에
// 기록하므로(migration 203), 입력 중 자동완성 호출이 "검색 조회 수"에 섞여 관심집중 키워드(get_trending_keywords)
// 랭킹을 왜곡했다. 이 API는 MiniSearch 인덱스(60초 캐시)만 조회해 로그를 남기지 않는다.
// 결과 화면(Enter·아이콘 검색)은 기존 /api/search/products를 그대로 쓰며 로그·CTR 학습은 그쪽에서만 일어난다.
//
// 응답 행은 /api/search/products 행과 같은 키(product_id·name·slug·category·price_min·sale_only·sale_price)를
// 써서 화면의 mapSearchApiRow를 그대로 재사용한다.

import { json, error as httpError } from '@sveltejs/kit'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { getPriceMinForProducts } from '$lib/server/getPriceMinForProducts'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { buildSuggestSearchPlan, interleaveSuggestHits } from '$lib/server/searchEngine/core/suggestSynonymMerge'
import type { RequestHandler } from './$types'

const MAX_SUGGEST_QUERY_LENGTH = 100

export const GET: RequestHandler = async ({ url, locals }) => {
  const q     = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '8')))

  // 화면(자동완성)이 2자 이상일 때만 호출하지만 서버에서도 동일하게 방어
  if (q.length < 2) return json({ results: [], query: q, limit })
  // 자동완성에 100자를 넘는 검색어는 의미가 없다 — 동의어 확장으로 요청당 검색이 늘어나므로 상한을 둔다(2026-10-27, sp3 MINOR-2)
  if (q.length > MAX_SUGGEST_QUERY_LENGTH) return json({ results: [], query: q.slice(0, MAX_SUGGEST_QUERY_LENGTH), limit })

  try {
    const index = await getProductSearchIndex()

    // 2026-10-27: 확정 동의어(소니↔Sony·본체→카메라 등)로 바꾼 검색어도 함께 찾는다 — MiniSearch(메모리)에서만 검색하므로 search_logs에 쌓이지 않는다.
    // 동의어 로드 실패·동의어 없음이면 계획이 원문 한 줄뿐이라 기존 동작과 100% 동일(fail-open).
    const synonymGroups = await loadSynonymGroups().catch(() => [])
    const hitById = new Map<string, ReturnType<typeof index.search>[number]>()
    const lists = buildSuggestSearchPlan(q, synonymGroups).map((step) =>
      index.search(step.term, { fuzzy: step.fuzzy, prefix: true, limit }).map((h) => {
        if (!hitById.has(h.document.id)) hitById.set(h.document.id, h)
        return h.document.id
      }),
    )
    const ids = interleaveSuggestHits(lists, limit)
    const hits = ids.flatMap((id) => hitById.get(id) ?? [])

    // 가격·판매전용 정보 배치 조회(드롭다운 메타 표기용) — 실패해도 이름만으로 동작
    const priceMap = await getPriceMinForProducts(locals.supabase, ids).catch(() => ({}) as Record<string, number>)
    const saleMap: Record<string, { sale_only: boolean; sale_price: number | null }> = {}
    if (ids.length > 0) {
      const { data } = await locals.supabase.from('products').select('id, sale_only, sale_price').in('id', ids)
      for (const r of (data ?? []) as { id: string; sale_only: boolean | null; sale_price: number | null }[]) {
        if (r.sale_only) saleMap[r.id] = { sale_only: true, sale_price: r.sale_price != null ? Number(r.sale_price) : null }
      }
    }

    const results = hits.map((h) => {
      const id = h.document.id
      return {
        product_id: id,
        id,
        name: h.document['name'],
        slug: h.document['slug'] ?? null,
        category: h.document['category'],
        price_min: priceMap[id] ?? null,
        sale_only: saleMap[id]?.sale_only ?? false,
        sale_price: saleMap[id]?.sale_price ?? null,
      }
    })

    return json({ results, query: q, limit })
  } catch (e) {
    console.error('[search/suggest] 오류:', e)
    return httpError(500, '자동완성 처리 중 오류가 발생했습니다.')
  }
}
