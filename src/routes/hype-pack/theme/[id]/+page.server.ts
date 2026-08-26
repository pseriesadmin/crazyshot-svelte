import { error } from '@sveltejs/kit'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import type { PageServerLoad } from './$types'

interface ThemeGroupProduct {
  id: string
  name: string
  slug: string | null
  image_urls: string[] | null
  base_price_daily: number
}

interface ThemeGroupWithProducts {
  id: string
  title: string
  sub_copy: string | null
  image_url: string
  sort_order: number
  products: ThemeGroupProduct[]
}

export interface ThemeGroupProductCard extends ThemeGroupProduct {
  price24h: number | null
  price12h: number | null
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const { session } = await locals.safeGetSession()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: groupsRaw } = await (locals.supabase.rpc as any)('get_hype_pack_theme_groups_with_products')
  const groups: ThemeGroupWithProducts[] = (groupsRaw as ThemeGroupWithProducts[] | null) ?? []

  const group = groups.find((g) => g.id === params.id)
  if (!group) throw error(404, '테마그룹을 찾을 수 없습니다.')

  const productIds = group.products.map((p) => p.id)
  const price12hMap: Record<string, number> = {}
  const price24hMap: Record<string, number> = {}
  if (productIds.length > 0) {
    const { data: priceRules } = await locals.supabase
      .from('price_rules')
      .select('product_id, duration_type, price')
      .in('product_id', productIds)
      .in('duration_type', ['12h', '24h'])
      .eq('is_active', true)
      .is('deleted_at', null)
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }
  }

  const products: ThemeGroupProductCard[] = group.products.map((p) => ({
    ...p,
    price24h: p.base_price_daily > 0 ? p.base_price_daily : (price24hMap[p.id] ?? null),
    price12h: price12hMap[p.id] ?? null,
  }))

  const wishedIds = await getWishedProductIds(locals.supabase, session?.user.id, productIds)

  return {
    group: {
      id:         group.id,
      title:      group.title,
      sub_copy:   group.sub_copy,
      image_url:  group.image_url,
      sort_order: group.sort_order,
    },
    products,
    wishedIds,
    isLoggedIn: !!session?.user.id,
  }
}
