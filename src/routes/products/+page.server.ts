import { getCategoryGroups } from '$lib/server/productCategorySettings'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  const urlCategory = url.searchParams.get('category') ?? 'all'

  // CMS 역할 확인
  let isCms = false
  if (session?.user.id) {
    const { data: profile } = await locals.supabase
      .from('user_profiles')
      .select('cms_role')
      .eq('id', session.user.id)
      .single()
    isCms = !!(profile as { cms_role?: string | null } | null)?.cms_role
  }

  // 페이지 설정 로드 (RPC — migration 118)
  const { data: settingsRaw, error: settingsErr } = await locals.supabase
    .rpc('get_product_page_settings')
  if (settingsErr) {
    console.error('[products] get_product_page_settings 실패:', settingsErr.message)
  }

  const settings = ((settingsRaw as unknown) as Record<string, unknown>) ?? {}

  type HeroSettings     = { products: { id: string; order: number }[]; mode: 'random' | 'fixed' }
  type GridSettings     = { category: string; count: number; sort: string }
  type MdSettings       = { products: { id: string; order: number }[]; mode: 'random' | 'fixed' }
  type CatSettings      = { items: { code_id: string; icon_key: string; sort_order: number }[] }
  type KeywordsSettings = { items: string[] }

  const heroSettings     = (settings['product_page_hero']       as HeroSettings)     ?? { products: [], mode: 'fixed' }
  const gridSettings     = (settings['product_page_grid']       as GridSettings)     ?? { category: 'all', count: 16, sort: 'latest' }
  const mdSettings       = (settings['product_page_md_picks']   as MdSettings)       ?? { products: [], mode: 'fixed' }
  const catSettings      = (settings['product_page_categories'] as CatSettings)      ?? { items: [] }
  const keywordsSettings = (settings['product_page_keywords']   as KeywordsSettings) ?? { items: [] }

  // 관심집중 키워드 — 동적 랭킹(검색 조회수 + 상품 상세 접근수 합산, 최근 7일)
  // 결과가 없으면 CMS 수동 설정 → +page.svelte KEYWORDS_FALLBACK 순으로 폴백
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: trendingRaw } = await (locals.supabase.rpc as any)('get_trending_keywords', { p_limit: 6, p_days: 7 })
  const trendingKeywords: string[] = Array.isArray(trendingRaw)
    ? (trendingRaw as string[]).filter(Boolean)
    : []

  // code_mapping_groups.default_category → 플랫폼 전역 카테고리 SSOT (상품필터 노출 설정 그룹만).
  // 상품상세(ProductHero)와 공유하는 헬퍼로 이관됨 — src/lib/server/productCategorySettings.ts
  const CMS_CATEGORIES = await getCategoryGroups()

  // get_products_by_ids(WHERE id = ANY(...))는 입력 배열 순서를 보장하지 않으므로,
  // 관리자가 드래그로 지정한 고정 순서(order)를 여기서 직접 재정렬한다.
  // mode='random'이면 매 요청마다 셔플 — 이전에는 이 값이 어디서도 읽히지 않아 무효였음.
  function applyProductOrder(
    cards: ProductCard[],
    setting: { products: { id: string; order: number }[]; mode: 'random' | 'fixed' },
  ): ProductCard[] {
    if (setting.mode === 'random') {
      const shuffled = [...cards]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    }
    const orderMap = new Map(setting.products.map((p) => [p.id, p.order]))
    return [...cards].sort(
      (a, b) => (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
  }

  const heroIds = heroSettings.products.map((p) => p.id)
  const mdIds   = mdSettings.products.map((p) => p.id)

  const [heroRes, gridRes, mdRes] = await Promise.all([
    // 헤더 슬라이드 상품
    heroIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: heroIds })
      : Promise.resolve({ data: [] as unknown[], error: null }),

    // 상품 그리드 (search_products RPC)
    // URL ?category= 파라미터가 CMS 그리드 설정보다 우선
    (locals.supabase.rpc as any)('search_products', { // eslint-disable-line @typescript-eslint/no-explicit-any
      p_query: '',
      p_category: urlCategory !== 'all'
        ? urlCategory
        : (gridSettings.category === 'all' ? null : gridSettings.category),
      p_page: 1,
      p_limit: gridSettings.count === 0 ? 100 : (gridSettings.count || 16),
      p_session_id: null,
      p_user_id: session?.user.id ?? null,
    }),

    // MD 추천 픽
    mdIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: mdIds })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  const heroProducts: ProductCard[] = applyProductOrder((heroRes.data ?? []) as ProductCard[], heroSettings)
  const gridProducts: ProductCard[] = ((gridRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
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
  }))
  const mdProducts: ProductCard[] = applyProductOrder((mdRes.data ?? []) as ProductCard[], mdSettings)

  // 12H·24H 실가격 배치 조회 — 전체 상품 ID 수집 후 price_rules 단일 쿼리
  const allIds = [
    ...heroProducts.map((p) => p.id),
    ...gridProducts.map((p) => p.id),
    ...mdProducts.map((p) => p.id),
  ].filter(Boolean)

  const wishedIds = await getWishedProductIds(locals.supabase, session?.user.id, allIds)

  const price12hMap: Record<string, number> = {}
  const price24hMap: Record<string, number> = {}
  if (allIds.length > 0) {
    const { data: priceRules } = await locals.supabase
      .from('price_rules')
      .select('product_id, duration_type, price')
      .in('product_id', allIds)
      .in('duration_type', ['12h', '24h'])
      .eq('is_active', true)
      .is('deleted_at', null)
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }
  }

  const mergePrice = (cards: ProductCard[]): ProductCard[] =>
    cards.map((c) => {
      const legacyDaily = c.base_price_daily
      const price_24h = legacyDaily > 0 ? legacyDaily : (price24hMap[c.id] ?? null)
      return { ...c, price_12h: price12hMap[c.id] ?? null, price_24h }
    })

  return {
    isCms,
    isLoggedIn: !!session?.user.id,
    wishedIds,
    urlCategory,
    settings: {
      hero:       heroSettings,
      grid:       gridSettings,
      mdPicks:    mdSettings,
      categories: catSettings,
      keywords:   trendingKeywords.length > 0
                    ? { items: trendingKeywords }
                    : keywordsSettings,
      keywordsRaw: keywordsSettings,
    },
    categories:   CMS_CATEGORIES,
    heroProducts: mergePrice(heroProducts),
    gridProducts: mergePrice(gridProducts),
    mdProducts:   mergePrice(mdProducts),
  }
}

// 클라이언트/서버 공유 타입
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
}
