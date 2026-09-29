import type { SupabaseClient } from '@supabase/supabase-js'

// /products 상품 목록(그리드) 조회·가격 합성 공용 모듈
// — 페이지 load(초기 20개)와 무한스크롤 추가 조회 엔드포인트(/products/_more)가 같은 로직을 공유해
//   가격 우선순위(price_rules > base_price_daily)·판매전용 처리·정렬 기준이 갈라지지 않게 한다.

export interface ProductCard {
  id: string
  name: string
  slug: string | null
  category: string
  image_urls: string[] | null
  base_price_daily: number
  product_caption: string | null
  is_active: boolean
  price_12h: number | null
  price_24h: number | null
  sale_only: boolean
  sale_price: number | null
}

export const GRID_SORTS = ['latest', 'random', 'views', 'rentals'] as const

export function resolveGridSort(sort: string | null | undefined): string {
  return GRID_SORTS.includes(sort as (typeof GRID_SORTS)[number]) ? (sort as string) : 'views'
}

/** RPC 행(get_products_sorted / search_products) → 카드(가격 미합성) */
export function mapGridRows(rows: Record<string, unknown>[]): ProductCard[] {
  return rows.map((r) => ({
    id:               String(r['product_id'] ?? r['id'] ?? ''),
    name:             String(r['name'] ?? ''),
    slug:             (r['slug'] as string | null) ?? null,
    category:         String(r['category'] ?? ''),
    image_urls:       r['image_urls'] != null
                        ? (r['image_urls'] as string[])
                        : r['image_url'] != null
                          ? [String(r['image_url'])]
                          : null,
    base_price_daily: Number(r['base_price_daily'] ?? r['price_min'] ?? 0),
    product_caption:  (r['product_caption'] as string | null) ?? null,
    is_active:        Boolean(r['is_active'] ?? true),
    price_12h:        null,
    price_24h:        null,
    sale_only:        false,
    sale_price:       null,
  }))
}

/** 노출 순서 설정대로 상위 limit개 조회. RPC 실패 시 search_products(최신순)로 폴백 */
export async function fetchGridRows(
  supabase: SupabaseClient,
  opts: { category: string | null; sort: string; limit: number; seed: string; userId: string | null },
): Promise<{ data: unknown[] | null }> {
  const viewed = await supabase.rpc('get_products_sorted', {
    p_category: opts.category,
    p_sort: opts.sort,
    p_limit: opts.limit,
    p_seed: opts.seed,
  })
  if (!viewed.error) return { data: viewed.data as unknown[] | null }
  console.error('[products] get_products_sorted 실패 — search_products 폴백:', viewed.error.message)
  const fallback = await supabase.rpc('search_products', {
    p_query: '',
    p_category: opts.category,
    p_page: 1,
    p_limit: opts.limit,
    p_session_id: null,
    p_user_id: opts.userId,
  })
  return { data: (fallback.data as unknown[] | null) ?? null }
}

/**
 * 12H·24H 실가격 + 판매전용 정보를 카드에 합성(입력 순서 그대로 반환).
 * 2026-09-09: CMS 가격정책(price_rules)이 항상 우선 — 24h 값이 있으면 그 값, price_rules가 전혀 없는
 * 레거시 미설정 상품만 옛 base_price_daily로 폴백(products/[id]/+page.server.ts attachPrices()와 동일 우선순위).
 * 판매전용(sale_only) 상품은 대여가격이 없는 게 정상이라 sale_price/sale_only를 별도 조회해 싣는다(products.md §2-9).
 */
export async function attachCardPrices(supabase: SupabaseClient, cards: ProductCard[]): Promise<ProductCard[]> {
  const ids = [...new Set(cards.map((c) => c.id).filter(Boolean))]
  const price12hMap: Record<string, number> = {}
  const price24hMap: Record<string, number> = {}
  const salePriceMap: Record<string, number> = {}
  const saleOnlyMap: Record<string, boolean> = {}

  if (ids.length > 0) {
    const [{ data: priceRules }, { data: saleRows }] = await Promise.all([
      supabase
        .from('price_rules')
        .select('product_id, duration_type, price')
        .in('product_id', ids)
        .in('duration_type', ['12h', '24h'])
        .eq('is_active', true)
        .is('deleted_at', null),
      supabase.from('products').select('id, sale_only, sale_price').in('id', ids),
    ])
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }
    for (const r of (saleRows ?? []) as { id: string; sale_only: boolean | null; sale_price: number | null }[]) {
      saleOnlyMap[r.id] = !!r.sale_only
      if (r.sale_price != null) salePriceMap[r.id] = Number(r.sale_price)
    }
  }

  return cards.map((c) => {
    const rule24h = price24hMap[c.id]
    const price_24h = rule24h != null ? rule24h : (c.base_price_daily > 0 ? c.base_price_daily : null)
    return {
      ...c,
      price_12h: price12hMap[c.id] ?? null,
      price_24h,
      sale_only: saleOnlyMap[c.id] ?? false,
      sale_price: salePriceMap[c.id] ?? null,
    }
  })
}
