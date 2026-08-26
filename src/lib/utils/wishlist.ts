// 상품 찜 토글 — /api/wishlist(toggle_product_wishlist RPC) 공용 클라이언트 헬퍼
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
    return data.action === 'added' ? 'added' : data.action === 'removed' ? 'removed' : null
  } catch {
    return null
  }
}
