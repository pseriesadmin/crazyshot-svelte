import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 주어진 상품 id 목록 중 사용자가 이미 찜(wishlist)한 것들의 id만 반환.
 * 비로그인이거나 후보 목록이 비어있으면 빈 배열(불필요한 쿼리 스킵).
 */
export async function getWishedProductIds(
  supabase: SupabaseClient,
  userId: string | undefined | null,
  productIds: string[],
): Promise<string[]> {
  if (!userId || productIds.length === 0) return []

  const { data } = await supabase
    .from('product_wishlists')
    .select('product_id')
    .eq('user_id', userId)
    .in('product_id', productIds)

  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id)
}
