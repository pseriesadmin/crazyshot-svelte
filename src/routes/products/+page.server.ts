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
  const { data: settingsRaw } = await locals.supabase
    .rpc('get_product_page_settings')

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

  // code_mapping_groups.default_category → 플랫폼 전역 카테고리 SSOT (상품필터 노출 설정 그룹만)
  const { data: groupsRaw } = await locals.supabase
    .from('code_mapping_groups')
    .select('name, default_category, sort_order')
    .not('default_category', 'is', null)
    .eq('is_active', true)
    .eq('show_in_product_filter', true)
    .order('sort_order')

  type GroupRow = { name: string; default_category: string; sort_order: number }
  const CMS_CATEGORIES = ((groupsRaw ?? []) as GroupRow[]).map((g) => ({
    id:         g.default_category,
    code:       g.default_category,
    name:       g.name,
    sort_order: g.sort_order,
  }))

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

  return {
    isCms,
    urlCategory,
    settings: {
      hero:       heroSettings,
      grid:       gridSettings,
      mdPicks:    mdSettings,
      categories: catSettings,
      keywords:   keywordsSettings,
    },
    categories:   CMS_CATEGORIES,
    heroProducts: (heroRes.data   ?? []) as ProductCard[],
    // search_products RPC는 product_id·price_min·image_url(단일) 반환 → ProductCard 형태로 정규화
    gridProducts: ((gridRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
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
    })) as ProductCard[],
    mdProducts:   (mdRes.data     ?? []) as ProductCard[],
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
}
