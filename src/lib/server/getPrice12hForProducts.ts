import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 주어진 상품 id 목록의 12시간 대여가(price_rules duration_type='12h')를 배치 조회.
 * 검색 화면이 예전엔 12h를 "24h × 0.7"로 계산해 표시해서 상세·목록·홈의 CMS 실값과 어긋났다(2026-09-30).
 * 상세(products/[id])·목록(productGrid.ts attachCardPrices)과 같은 기준 — 활성 규칙만(is_active, deleted_at IS NULL).
 * 12h 규칙이 없는 상품은 맵에 키가 없다(호출부는 null로 두어 12H 표시를 생략).
 */
export async function getPrice12hForProducts(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const { data, error } = await supabase
    .from('price_rules')
    .select('product_id, price')
    .eq('duration_type', '12h')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('product_id', ids)

  if (error) {
    console.error('[search] price_rules 12h 조회 실패 — 12H 표시 생략:', error.message)
    return {}
  }

  const priceMap: Record<string, number> = {}
  for (const row of (data ?? []) as { product_id: string; price: number | string }[]) {
    priceMap[row.product_id] = Number(row.price)
  }
  return priceMap
}
