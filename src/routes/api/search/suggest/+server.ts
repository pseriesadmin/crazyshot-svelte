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
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, locals }) => {
  const q     = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '8')))

  // 화면(자동완성)이 2자 이상일 때만 호출하지만 서버에서도 동일하게 방어
  if (q.length < 2) return json({ results: [], query: q, limit })

  try {
    const index = await getProductSearchIndex()
    const hits = index.search(q, { fuzzy: 0.2, prefix: true, limit })
    const ids = hits.map((h) => h.document.id)

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
