import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

export type BannerSlot = {
  id: string
  slot_key: string
  title: string | null
  sub_copy: string | null
  image_url: string
  link_url: string | null
  device_type: string
  sort_order: number
  is_active: boolean
  valid_from: string | null
  valid_until: string | null
}

export const load: PageServerLoad = async ({ locals }) => {
  const now = new Date().toISOString()

  const { session } = await locals.safeGetSession()
  let isCms = false
  if (session?.user.id) {
    const { data: profile } = await locals.supabase
      .from('user_profiles')
      .select('cms_role')
      .eq('id', session.user.id)
      .single()
    isCms = !!(profile as { cms_role?: string | null } | null)?.cms_role
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as unknown as any

  const { data: banners } = await db
    .from('banners')
    .select('id, slot_key, title, sub_copy, image_url, link_url, device_type, sort_order')
    .eq('is_active', true)
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('slot_key')
    .order('sort_order')

  // slot_key 별로 그룹핑 (표시용 — is_active + 날짜 필터 적용)
  const bannerMap: Record<string, BannerSlot[]> = {}
  for (const b of banners ?? []) {
    if (!bannerMap[b.slot_key]) bannerMap[b.slot_key] = []
    bannerMap[b.slot_key].push(b as BannerSlot)
  }

  // ── 홈 히어로 배너 RAW (편집용 — 필터 없이 전체, is_active 무관) ──────────
  // 주의: 이 데이터는 HomeBannerModal(CMS 편집)에만 전달 — 표시용은 bannerMap 사용
  const { data: heroBannersRaw } = await db
    .from('banners')
    .select('id, slot_key, title, sub_copy, image_url, link_url, sort_order, is_active')
    .in('slot_key', ['hero_pc', 'hero_mobile'])
    .is('deleted_at', null)
    .order('slot_key')
    .order('sort_order')

  type HeroBannerRow = {
    id: string; slot_key: string; title: string | null; sub_copy: string | null
    image_url: string; link_url: string | null; sort_order: number; is_active: boolean
  }
  const heroBannerRowsRaw = {
    hero_pc:     ((heroBannersRaw ?? []) as HeroBannerRow[]).filter((b) => b.slot_key === 'hero_pc'),
    hero_mobile: ((heroBannersRaw ?? []) as HeroBannerRow[]).filter((b) => b.slot_key === 'hero_mobile'),
  }

  // ── 홈 히어로 배너 설정 (pc_mode / mobile_mode) ──────────────────────────
  const { data: heroBannerSettingsRow } = await locals.supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'home_hero_banner_settings')
    .maybeSingle()

  type HeroBannerSettings = { pc_mode: 'random' | 'fixed'; mobile_mode: 'random' | 'fixed' }
  const heroBannerSettings: HeroBannerSettings =
    ((heroBannerSettingsRow as { value: unknown } | null)?.value as HeroBannerSettings | null) ??
    { pc_mode: 'fixed', mobile_mode: 'fixed' }

  // BUG-FIX(2026-08-10): 홈 화면 카테고리 탭이 하드코딩 배열(CATEGORY_TABS)로 고정돼
  // 있었음 — /products와 동일하게 백오피스(code_mapping_groups) 값으로 통일. RLS가
  // is_cms_user()라 service_role 사용(RLS 정책 자체는 무변경, 비민감 카테고리 라벨
  // 조회이므로 안전). Stephen 확정: code_mapping_groups가 유일한 정본 — "그룹명"(name)이
  // 곧 노출 라벨, product_category_codes는 무관한 별개 코드체계라 관여시키지 않는다.
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { data: groupsRaw } = await admin
    .from('code_mapping_groups')
    .select('name, default_category, sort_order')
    .not('default_category', 'is', null)
    .eq('is_active', true)
    .eq('show_in_product_filter', true)
    .order('sort_order')

  type GroupRow = { name: string; default_category: string; sort_order: number }
  const categories = ((groupsRaw ?? []) as GroupRow[]).map((g) => ({
    id:         g.default_category,
    code:       g.default_category,
    name:       g.name,
    sort_order: g.sort_order,
  }))

  // ── 1-A. 크레이지로그 미리보기 동기화 ─────────────────────────────
  // get_crazylog_banner_settings: anon GRANT 있음 (migration 210 + 262)
  // get_crazylog_posts_by_ids: anon GRANT 있음 (migration 210 + 262)
  type CrazylogPostRow = {
    id: string
    title: string
    log_type: string | null
    thumbnail_url: string | null
  }

  const SLOT_FALLBACK_COLORS: Record<string, string> = {
    crazylog_banner_slot1: '#201857',
    crazylog_banner_slot2: '#cf0000',
    crazylog_banner_slot3: '#3b2f8a',
  }
  const LOG_TYPE_COLORS: Record<string, string> = {
    '상품리뷰': '#ff3535',
    '일상공유': '#553fe0',
    '채널홍보': '#3b2f8a',
  }

  let crazylogPosts: Array<{ id: string; img: string; cat: string; catBg: string; title: string; desc: string | null }> = []

  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: clSettingsData } = await (db.rpc as any)('get_crazylog_banner_settings')
    const clSettings = (clSettingsData ?? {}) as Record<string, { posts: Array<{ id: string }>; mode: string } | undefined>

    const SLOT_KEYS = ['crazylog_banner_slot1', 'crazylog_banner_slot2', 'crazylog_banner_slot3'] as const
    const seenIds = new Set<string>()
    const orderedIds: string[] = []
    const postSlotMap = new Map<string, string>()
    let anyRandom = false

    for (const key of SLOT_KEYS) {
      const slot = clSettings[key]
      if (!slot) continue
      if (slot.mode === 'random') anyRandom = true
      for (const p of slot.posts) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id)
          orderedIds.push(p.id)
          postSlotMap.set(p.id, key)
        }
      }
    }

    if (orderedIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: postsData } = await (db.rpc as any)('get_crazylog_posts_by_ids', { p_ids: orderedIds })

      const postById = new Map<string, CrazylogPostRow>()
      for (const row of (postsData ?? []) as CrazylogPostRow[]) {
        postById.set(row.id, row)
      }

      let pool = orderedIds
        .map((id) => postById.get(id))
        .filter((p): p is CrazylogPostRow => !!p)

      if (anyRandom) {
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
      }

      crazylogPosts = pool.slice(0, 5).map((row) => {
        const slotKey = postSlotMap.get(row.id) ?? 'crazylog_banner_slot1'
        const catBg = LOG_TYPE_COLORS[row.log_type ?? ''] ?? SLOT_FALLBACK_COLORS[slotKey] ?? '#201857'
        return {
          id:     row.id,
          img:    row.thumbnail_url ?? '',
          cat:    row.log_type ?? 'Flash Deals',
          catBg,
          title:  row.title,
          desc:   null,
        }
      })
    }
  }

  // ── 1-B. 헬프 FAQ 상위 5개 ──────────────────────────────────────────
  // canned_responses: cr_read 정책 (FOR SELECT USING (true)) → anon 가능
  const { data: faqRaw } = await locals.supabase
    .from('canned_responses')
    .select('id, title, content, help_category')
    .order('usage_count', { ascending: false })
    .order('title', { ascending: true })
    .limit(5)

  const topFaqs = (faqRaw ?? []) as Array<{ id: string; title: string; content: string; help_category: string }>

  // ── 1-B. 헬프 히어로 배경이미지 ─────────────────────────────────────
  // help_hero_bg_images: migration 312 "public read display keys" 정책 → anon 가능
  const { data: heroBgRow } = await locals.supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'help_hero_bg_images')
    .maybeSingle()

  type HeroBgValue = { images?: Array<{ url: string; path: string }>; mode?: 'random' | 'fixed' }
  const heroBgVal = ((heroBgRow as { value: unknown } | null)?.value ?? {}) as HeroBgValue
  const heroBgImages = heroBgVal.images ?? []
  const heroBgModeVal: 'random' | 'fixed' = heroBgVal.mode ?? 'random'

  let faqHeroBgUrl = ''
  if (heroBgImages.length > 0) {
    faqHeroBgUrl =
      heroBgModeVal === 'random'
        ? heroBgImages[Math.floor(Math.random() * heroBgImages.length)].url
        : heroBgImages[0].url
  }

  // ── Phase 3: 취향직격 테마그룹 ────────────────────────────────────────
  // get_home_theme_groups_with_products: migration #322 — stage 적용 전까지 오류 무시
  type ThemeGroupProduct = {
    id: string; name: string; slug: string;
    image_urls: string[] | null; base_price_daily: number
    price_12h?: number | null; price_24h?: number | null
  }
  type ThemeGroupWithProducts = {
    id: string; title: string; sub_copy: string | null;
    image_url: string; sort_order: number; products: ThemeGroupProduct[]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tgData, error: tgError } = await (db.rpc as any)('get_home_theme_groups_with_products')
  const themeGroups: ThemeGroupWithProducts[] = tgError
    ? []
    : ((tgData as ThemeGroupWithProducts[] | null) ?? [])

  // ── Phase 4: 카테고리+상품 큐레이션 ────────────────────────────────────────
  // home_category_products: migration #325 적용 후 RLS 화이트리스트 추가됨
  // 적용 전에는 maybeSingle() → null → { items: [] } 폴백으로 슬라이더 빈 상태
  const [catProductsSettingRes, catPageSettingRes, kwPageSettingRes] = await Promise.all([
    locals.supabase.from('cms_settings').select('value').eq('key', 'home_category_products').maybeSingle(),
    locals.supabase.from('cms_settings').select('value').eq('key', 'product_page_categories').maybeSingle(),
    locals.supabase.from('cms_settings').select('value').eq('key', 'product_page_keywords').maybeSingle(),
  ])

  type CatProductEntry = { category_id: string; products: { id: string; order: number }[]; mode: 'random' | 'fixed' }
  type HomeCatProductsRaw = { items: CatProductEntry[] }

  const homeCategoryProductsRaw: HomeCatProductsRaw =
    ((catProductsSettingRes.data as { value: unknown } | null)?.value as HomeCatProductsRaw | null) ??
    { items: [] }

  const categoryPageSettings =
    ((catPageSettingRes.data as { value: unknown } | null)?.value as {
      items: { code_id: string; icon_key: string; sort_order: number; icon_url?: string | null }[]
    } | null) ?? { items: [] }

  const keywordsPageSettings =
    ((kwPageSettingRes.data as { value: unknown } | null)?.value as { items: string[] } | null) ??
    { items: [] }

  // 전체 상품 ID 수집 + get_products_by_ids 일괄 조회
  type HomeProductRow = {
    id: string; name: string; slug: string; category: string
    image_urls: string[] | null; base_price_daily: number
    product_caption: string | null; is_active: boolean
    price_12h?: number | null; price_24h?: number | null
  }

  const allCatProductIds = [
    ...new Set(homeCategoryProductsRaw.items.flatMap((it) => it.products.map((p) => p.id)))
  ]

  let homeProductRows: HomeProductRow[] = []
  if (allCatProductIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prodsData } = await (db.rpc as any)('get_products_by_ids', { p_ids: allCatProductIds })
    homeProductRows = (prodsData as HomeProductRow[] | null) ?? []
  }

  const homeProductById = new Map<string, HomeProductRow>()
  for (const p of homeProductRows) homeProductById.set(p.id, p)

  const categoryProducts: Record<string, HomeProductRow[]> = {}
  for (const item of homeCategoryProductsRaw.items) {
    const ordered: HomeProductRow[] = item.products
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => homeProductById.get(p.id))
      .filter((p): p is HomeProductRow => !!p)

    if (item.mode === 'random') {
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
      }
    }
    categoryProducts[item.category_id] = ordered
  }

  // ── 표준 상품슬라이드(prod-card) Day/12H 이중가격 — Figma node 600:862 스펙 반영 ──
  // price_24h(Day)는 legacy base_price_daily 우선(기존 mergePrice 패턴과 동일), price_12h는 price_rules 전용
  const priceProductIds = [
    ...new Set([
      ...themeGroups.flatMap((g) => g.products.map((p) => p.id)),
      ...Object.values(categoryProducts).flatMap((rows) => rows.map((p) => p.id)),
    ]),
  ]
  const price12hMap: Record<string, number> = {}
  const price24hMap: Record<string, number> = {}
  if (priceProductIds.length > 0) {
    const { data: priceRules } = await locals.supabase
      .from('price_rules')
      .select('product_id, duration_type, price')
      .in('product_id', priceProductIds)
      .in('duration_type', ['12h', '24h'])
      .eq('is_active', true)
      .is('deleted_at', null)
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }
  }
  const withDualPrice = <T extends { id: string; base_price_daily: number }>(p: T) => ({
    ...p,
    price_12h: price12hMap[p.id] ?? null,
    price_24h: p.base_price_daily > 0 ? p.base_price_daily : (price24hMap[p.id] ?? null),
  })
  for (const g of themeGroups) g.products = g.products.map(withDualPrice)
  for (const key of Object.keys(categoryProducts)) categoryProducts[key] = categoryProducts[key].map(withDualPrice)

  return {
    bannerMap, isCms, categories, crazylogPosts, topFaqs, faqHeroBgUrl,
    heroBannerRowsRaw, heroBannerSettings, themeGroups,
    homeCategoryProductsRaw, categoryProducts, categoryPageSettings, keywordsPageSettings,
  }
}
