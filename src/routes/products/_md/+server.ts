import { json } from '@sveltejs/kit'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import { loadProductBadgeMap } from '$lib/server/productBadges'
import { loadCardKeywordMap } from '$lib/server/productCardKeywords'
import { loadMobileImageMap } from '$lib/server/productMobileImages'
import { attachCardPrices, type ProductCard } from '$lib/server/products/productGrid'
import { orderByOnceSeed, type ProductListMode } from '$lib/utils/productListOrder'
import { resolveOnceSeed } from '$lib/server/onceRandomSeed'
import type { RequestHandler } from './$types'

// 찜 추가 직후 'MD 추천' 바텀 팝업이 쓰는 조회 — /products 페이지의 MD 추천 구간과 같은 설정(product_page_md_picks)·같은 정렬 규칙·같은 카드 정보
// GET /products/_md  →  { products, wishedIds, productBadges, productCardKeywords, mdMobileImages }
export const GET: RequestHandler = async ({ locals, url, cookies }) => {
  const { session } = await locals.safeGetSession()

  const { data: settingsRaw, error: settingsError } = await locals.supabase.rpc('get_product_page_settings')
  if (settingsError) {
    console.error('[products/_md] get_product_page_settings 실패:', settingsError.message)
    return json({ error: 'settings_unavailable' }, { status: 500 })
  }
  const md = ((settingsRaw as Record<string, unknown> | null)?.['product_page_md_picks'] ?? { products: [], mode: 'fixed' }) as {
    products?: { id: string; order: number }[]
    mode?: ProductListMode
  }
  const setting = { products: md.products ?? [], mode: (md.mode ?? 'fixed') as ProductListMode }
  const ids = setting.products.map((p) => p.id)
  if (ids.length === 0) {
    return json({ products: [], wishedIds: [], productBadges: {}, productCardKeywords: {}, mdMobileImages: {} })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: ids })
  const cards = (data ?? []) as ProductCard[]

  // get_products_by_ids 는 입력 순서를 보장하지 않으므로 페이지 load 와 같은 규칙으로 재정렬(고정/랜덤/1회 랜덤)
  let ordered: ProductCard[]
  if (setting.mode === 'random_once') {
    ordered = orderByOnceSeed(cards, resolveOnceSeed(cookies, url.protocol === 'https:'), 'md')
  } else if (setting.mode === 'random') {
    ordered = [...cards]
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
    }
  } else {
    const orderMap = new Map(setting.products.map((p) => [p.id, p.order]))
    ordered = [...cards].sort((a, b) => (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }

  const products = await attachCardPrices(locals.supabase, ordered)
  const productIds = products.map((p) => p.id)
  const [wishedIds, productBadges, productCardKeywords, mdMobileImages] = await Promise.all([
    getWishedProductIds(locals.supabase, session?.user.id, productIds),
    loadProductBadgeMap(locals.supabase, productIds),
    loadCardKeywordMap(locals.supabase, productIds),
    loadMobileImageMap(locals.supabase, productIds),
  ])

  return json({ products, wishedIds, productBadges, productCardKeywords, mdMobileImages })
}
