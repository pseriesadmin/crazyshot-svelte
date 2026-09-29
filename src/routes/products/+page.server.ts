import { getCategoryGroups } from '$lib/server/productCategorySettings'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import { attachCardPrices, fetchGridRows, mapGridRows, resolveGridSort, type ProductCard } from '$lib/server/products/productGrid'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  const urlCategory = url.searchParams.get('category') ?? 'all'
  // "전체" 목록 무한스크롤 — 처음 INFINITE_INITIAL개만 서버에서 내려주고, 이후 10개씩은 클라이언트가
  // 목록 전용 엔드포인트(/products/_more)로 가져온다(페이지 전체 load 재실행 없음). 카테고리 미선택(all)에서만 적용.
  const INFINITE_INITIAL = 20
  const infiniteMode = urlCategory === 'all'
  const infiniteLimit = infiniteMode ? INFINITE_INITIAL : 0
  // 랜덤 순서 시드 — 이후 추가 조회에서도 같은 순서를 유지하려고 클라이언트가 그대로 다시 보낸다
  const seed = url.searchParams.get('seed') ?? Math.random().toString(36).slice(2, 10)

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
  type CategoryBannerSettings = {
    items: { category_id: string; image_url: string | null; mobile_image_url?: string | null; link_url: string | null; alt: string; enabled: boolean }[]
    mid_banner?: { enabled: boolean; image_url: string | null; title: string; sub: string; link_url: string | null } | null
  }

  const heroSettings     = (settings['product_page_hero']       as HeroSettings)     ?? { products: [], mode: 'fixed' }
  const gridSettings     = (settings['product_page_grid']       as GridSettings)     ?? { category: 'all', count: 16, sort: 'views' }
  const mdSettings       = (settings['product_page_md_picks']   as MdSettings)       ?? { products: [], mode: 'fixed' }
  const catSettings      = (settings['product_page_categories'] as CatSettings)      ?? { items: [] }
  const keywordsSettings = (settings['product_page_keywords']   as KeywordsSettings) ?? { items: [] }
  const categoryBannerSettings = (settings['product_page_category_banners'] as CategoryBannerSettings) ?? { items: [] }

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

  // 모바일 목록·카테고리 선택 시 목록은 기존 CMS 그리드 설정 개수 그대로 사용
  const mobileGridCount = gridSettings.count === 0 ? 100 : (gridSettings.count || 16)

  const heroIds = heroSettings.products.map((p) => p.id)
  const mdIds   = mdSettings.products.map((p) => p.id)

  const [heroRes, gridRes, mdRes] = await Promise.all([
    // 헤더 슬라이드 상품
    heroIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: heroIds })
      : Promise.resolve({ data: [] as unknown[], error: null }),

    // 상품 그리드 — 노출 기준: CMS 노출 순서 설정(최신/랜덤/조회수/렌탈 많은 순, PC·모바일 공통)
    // URL ?category= 파라미터가 CMS 그리드 설정보다 우선. RPC 실패 시 search_products(최신순)로 폴백(공용 모듈)
    fetchGridRows(locals.supabase, {
      category: urlCategory !== 'all'
        ? urlCategory
        : (gridSettings.category === 'all' ? null : gridSettings.category),
      sort: resolveGridSort(gridSettings.sort),
      limit: infiniteMode ? infiniteLimit : mobileGridCount,
      seed,
      userId: session?.user.id ?? null,
    }),

    // MD 추천 픽
    mdIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: mdIds })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  const heroProducts: ProductCard[] = applyProductOrder((heroRes.data ?? []) as ProductCard[], heroSettings)
  const gridProducts: ProductCard[] = mapGridRows((gridRes.data ?? []) as Record<string, unknown>[])
  const mdProducts: ProductCard[] = applyProductOrder((mdRes.data ?? []) as ProductCard[], mdSettings)

  // 12H·24H 실가격·판매전용 정보 합성 — 공용 모듈(추가 조회 엔드포인트와 동일 로직)
  const allIds = [
    ...heroProducts.map((p) => p.id),
    ...gridProducts.map((p) => p.id),
    ...mdProducts.map((p) => p.id),
  ].filter(Boolean)

  const wishedIds = await getWishedProductIds(locals.supabase, session?.user.id, allIds)

  const pricedAll = await attachCardPrices(locals.supabase, [...heroProducts, ...gridProducts, ...mdProducts])
  const pricedHero = pricedAll.slice(0, heroProducts.length)
  const pricedGrid = pricedAll.slice(heroProducts.length, heroProducts.length + gridProducts.length)
  const pricedMd = pricedAll.slice(heroProducts.length + gridProducts.length)

  return {
    isCms,
    isLoggedIn: !!session?.user.id,
    wishedIds,
    urlCategory,
    infiniteMode,
    infiniteLimit,
    seed,
    mobileGridCount,
    settings: {
      hero:       heroSettings,
      grid:       gridSettings,
      mdPicks:    mdSettings,
      categories: catSettings,
      categoryBanners: categoryBannerSettings,
      keywords:   trendingKeywords.length > 0
                    ? { items: trendingKeywords }
                    : keywordsSettings,
      keywordsRaw: keywordsSettings,
    },
    categories:   CMS_CATEGORIES,
    heroProducts: pricedHero,
    gridProducts: pricedGrid,
    mdProducts:   pricedMd,
  }
}

// 클라이언트/서버 공유 타입 — 정의는 공용 모듈로 이동(추가 조회 엔드포인트와 공유)
export type { ProductCard } from '$lib/server/products/productGrid'
