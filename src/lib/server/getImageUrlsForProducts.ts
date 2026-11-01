import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 주어진 상품 id 목록의 이미지 목록(products.image_urls)을 배치 조회.
 * 검색 API의 보충 결과(MiniSearch 자연어 폴백 natural_fallback · 의미 후보 semantic)는 search_products RPC를 거치지 않아
 * image_urls 필드 자체가 없다 — 그대로 두면 검색 화면이 "등록 안 된 기본 이미지"로 보여준다(2026-11-01, bam·Rode·Sam·San 검색에서 발견).
 * getPriceMinForProducts 와 같은 방식으로 이미지를 채워 넣을 때 사용한다.
 * 이미지가 없는 상품·조회 실패는 맵에 키가 없다(호출부는 기존 기본 이미지로 둔다 — 검색 자체는 계속 동작).
 */
export async function getImageUrlsForProducts(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<Record<string, string[]>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const { data, error } = await supabase.from('products').select('id, image_urls').in('id', ids)
  if (error) {
    console.error('[search] products image_urls 조회 실패 — 기본 이미지 유지:', error.message)
    return {}
  }

  const out: Record<string, string[]> = {}
  for (const row of (data ?? []) as { id: string; image_urls: unknown }[]) {
    if (!Array.isArray(row.image_urls)) continue
    const urls = row.image_urls.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    if (urls.length > 0) out[row.id] = urls
  }
  return out
}
