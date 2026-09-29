import { json } from '@sveltejs/kit'
import { attachCardPrices, fetchGridRows, mapGridRows, resolveGridSort } from '$lib/server/products/productGrid'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import type { RequestHandler } from './$types'

// /products "전체" 목록 무한스크롤 추가 조회 — 목록(그리드)만 가져온다(hero·MD추천·키워드 등 페이지 전체 load 재실행 없음).
// GET /products/_more?offset=20&limit=10&seed=abc  →  { products, wishedIds, hasMore }
const MAX_TOTAL = 200 // get_products_sorted 조회 상한(Migration #579)과 동일

export const GET: RequestHandler = async ({ locals, url }) => {
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
  const limit = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 10)))
  const seed = (url.searchParams.get('seed') ?? '').slice(0, 32)
  const total = Math.min(MAX_TOTAL, offset + limit)
  if (offset >= MAX_TOTAL) return json({ products: [], wishedIds: [], hasMore: false })

  const { session } = await locals.safeGetSession()

  // 노출 순서·카테고리 설정(product_page_grid) — 페이지 load와 같은 설정 RPC 1회만 조회
  const { data: settingsRaw, error: settingsError } = await locals.supabase.rpc('get_product_page_settings')
  if (settingsError) {
    console.error('[products/_more] get_product_page_settings 실패:', settingsError.message)
    return json({ error: 'settings_unavailable' }, { status: 500 })
  }
  const grid = ((settingsRaw as Record<string, unknown> | null)?.['product_page_grid'] ?? {}) as {
    category?: string
    sort?: string
  }

  const { data } = await fetchGridRows(locals.supabase, {
    category: !grid.category || grid.category === 'all' ? null : grid.category,
    sort: resolveGridSort(grid.sort),
    limit: total,
    seed,
    userId: session?.user.id ?? null,
  })

  const rows = (data ?? []) as Record<string, unknown>[]
  const page = mapGridRows(rows).slice(offset)
  const products = await attachCardPrices(locals.supabase, page)
  const wishedIds = await getWishedProductIds(locals.supabase, session?.user.id, products.map((p) => p.id))

  return json({ products, wishedIds, hasMore: rows.length >= total && total < MAX_TOTAL })
}
