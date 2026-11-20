// 상품 찜 토글 — /api/wishlist(toggle_product_wishlist RPC) 공용 클라이언트 헬퍼
// 찜을 '추가'하는 데 성공하면 'MD 추천' 바텀 팝업을 연다(2026-11-18 Stephen 지시 — 모든 화면 공통, 해제 때는 열지 않음)
import { openWishMdSheet } from '$lib/stores/wishMdSheet.svelte'

export async function toggleWish(productId: string): Promise<'added' | 'removed' | null> {
  try {
    const res = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId }),
    })
    if (!res.ok) return null
    const data = await res.json() as { ok: boolean; action?: string }
    if (!data.ok) return null
    if (data.action === 'added') {
      openWishMdSheet()
      return 'added'
    }
    return data.action === 'removed' ? 'removed' : null
  } catch {
    return null
  }
}
