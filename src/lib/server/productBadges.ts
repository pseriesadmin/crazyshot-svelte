// 고객 화면 상품 배지 일괄 조회 — 화면에 내려가는 상품 id 묶음으로 get_product_badges 를 1회만 호출한다(N+1 금지).
// 실패해도 화면은 배지 없이 정상 표시한다(fail-soft).
import type { CustomerBadge } from '$lib/types/badge'

export const MAX_BADGE_PRODUCT_IDS = 200

export type ProductBadgeMap = Record<string, CustomerBadge[]>

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export function groupBadgesByProduct(rows: CustomerBadge[]): ProductBadgeMap {
  const map: ProductBadgeMap = {}
  for (const r of rows) {
    ;(map[r.product_id] ??= []).push(r)
  }
  return map
}

export async function loadProductBadgeMap(client: unknown, productIds: Array<string | null | undefined>): Promise<ProductBadgeMap> {
  const ids = [...new Set(productIds.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, MAX_BADGE_PRODUCT_IDS)
  if (ids.length === 0) return {}
  try {
    const { data, error } = await (client as RpcClient).rpc('get_product_badges', { p_product_ids: ids })
    if (error || !Array.isArray(data)) return {}
    return groupBadgesByProduct(data as CustomerBadge[])
  } catch {
    return {}
  }
}

/** 카트 상품에 붙은 배지가 연결한 쿠폰 id 집합(장바구니 쿠폰 목록 표식용) — 실패하면 빈 집합(fail-soft) */
export async function loadBadgeCouponIds(client: unknown, productIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(productIds.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, MAX_BADGE_PRODUCT_IDS)
  if (ids.length === 0) return new Set()
  try {
    const { data, error } = await (client as RpcClient).rpc('get_badge_coupon_ids', { p_product_ids: ids })
    if (error || !Array.isArray(data)) return new Set()
    return new Set((data as unknown[]).filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/** 보유 쿠폰 목록에 badgeLinked 표식을 달고 연동 쿠폰을 앞으로 보낸다(나머지 순서는 그대로 유지). 가격·할인 계산에는 관여하지 않는다. */
export function markBadgeLinkedCoupons<T extends { coupon_id: string }>(rows: T[], linkedCouponIds: Set<string>): Array<T & { badgeLinked: boolean }> {
  const marked = rows.map((r) => ({ ...r, badgeLinked: linkedCouponIds.has(r.coupon_id) }))
  return [...marked.filter((r) => r.badgeLinked), ...marked.filter((r) => !r.badgeLinked)]
}
