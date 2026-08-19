import type { PageServerLoad } from './$types'
import { getCategoryKeyByGroupName } from '$lib/server/productCategorySettings'

interface RawBannerItem {
  product_id: string
  subtitle: string
  order: number
  pc_image_url?: string | null
  mobile_image_url?: string | null
}

interface RawBannerSettings {
  mode: 'random' | 'fixed'
  items: RawBannerItem[]
  keywords: string[]
}

export interface EnrichedBannerItem {
  product_id: string
  subtitle: string
  order: number
  name: string
  slug: string | null
  image_url: string | null
  pc_image_url: string | null
  mobile_image_url: string | null
  price24h: number | null
  price12h: number | null
}

export const load: PageServerLoad = async ({ locals }) => {
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

  // 배너 상품 검색을 "패키지" 카테고리로 잠그기 위한 정본 카테고리 키(code_mapping_groups)
  const packageCategoryKey = await getCategoryKeyByGroupName('패키지')

  // Load banner settings from cms_settings
  const { data: settingRow } = await locals.supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'hype_pack_banner')
    .maybeSingle() as { data: { value: unknown } | null }

  const raw: RawBannerSettings = (settingRow?.value as RawBannerSettings) ?? {
    mode: 'fixed',
    items: [],
    keywords: [],
  }

  // Enrich with product data
  let enrichedItems: EnrichedBannerItem[] = []
  if (raw.items.length > 0) {
    const ids = raw.items.map((i) => i.product_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: products } = await (locals.supabase.rpc as any)('get_products_by_ids', { p_ids: ids })
    const prodMap = new Map<string, { name: string; slug: string | null; image_urls: string[] | null; base_price_daily: number }>()
    for (const p of (products ?? []) as Record<string, unknown>[]) {
      const id = String(p['id'] ?? '')
      if (id) prodMap.set(id, {
        name:             String(p['name'] ?? ''),
        slug:             (p['slug'] as string | null) ?? null,
        image_urls:       (p['image_urls'] as string[] | null) ?? null,
        base_price_daily: Number(p['base_price_daily'] ?? 0),
      })
    }

    // 12H·24H 실가격 배치 조회 (products.md §대여 기준가격 패턴과 동일)
    const price12hMap: Record<string, number> = {}
    const price24hMap: Record<string, number> = {}
    const { data: priceRules } = await locals.supabase
      .from('price_rules')
      .select('product_id, duration_type, price')
      .in('product_id', ids)
      .in('duration_type', ['12h', '24h'])
      .eq('is_active', true)
      .is('deleted_at', null)
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }

    enrichedItems = raw.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => {
        const prod = prodMap.get(item.product_id)
        const fallbackImage = prod?.image_urls?.[0] ?? null
        const legacyDaily = prod?.base_price_daily ?? 0
        return {
          product_id:       item.product_id,
          subtitle:         item.subtitle,
          order:            item.order,
          name:             prod?.name ?? '',
          slug:             prod?.slug ?? null,
          image_url:        fallbackImage,
          pc_image_url:     item.pc_image_url ?? fallbackImage,
          mobile_image_url: item.mobile_image_url ?? fallbackImage,
          price24h: legacyDaily > 0 ? legacyDaily : (price24hMap[item.product_id] ?? null),
          price12h: price12hMap[item.product_id] ?? null,
        }
      })
      .filter((i) => i.name)
  }

  return {
    isCms,
    packageCategoryKey,
    banner: {
      mode:     raw.mode,
      items:    enrichedItems,
      keywords: raw.keywords,
    },
    // raw settings for modal initialSettings — pc/mobile_image_url 필드 정규화(null로 채움)
    bannerRaw: {
      mode: raw.mode,
      keywords: raw.keywords,
      items: raw.items.map((item) => ({
        product_id:       item.product_id,
        subtitle:         item.subtitle,
        order:            item.order,
        pc_image_url:     item.pc_image_url ?? null,
        mobile_image_url: item.mobile_image_url ?? null,
      })),
    },
  }
}
