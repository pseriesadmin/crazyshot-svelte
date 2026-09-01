import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 주어진 상품 id 목록의 일일 대여가(price_rules duration_type='24h')를 배치 조회.
 * MiniSearch 자연어 폴백 검색 결과(natural_fallback)는 search_products RPC를 거치지 않아
 * price_min 필드 자체가 없다 — 검색 API가 이 결과에 가격을 채워 넣을 때 사용.
 */
export async function getPriceMinForProducts(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<Record<string, number>> {
  if (productIds.length === 0) return {}

  const { data } = await supabase
    .from('price_rules')
    .select('product_id, price')
    .eq('duration_type', '24h')
    .in('product_id', productIds)

  const priceMap: Record<string, number> = {}
  for (const row of (data ?? []) as { product_id: string; price: number }[]) {
    priceMap[row.product_id] = Number(row.price)
  }
  return priceMap
}
