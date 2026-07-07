import type { PageServerLoad } from './$types'

export type BannerSlot = {
  id: string
  slot_key: string
  title: string | null
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as unknown as any

  const { data: banners } = await db
    .from('banners')
    .select('id, slot_key, title, image_url, link_url, device_type, sort_order')
    .eq('is_active', true)
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('slot_key')
    .order('sort_order')

  // slot_key 별로 그룹핑
  const bannerMap: Record<string, BannerSlot[]> = {}
  for (const b of banners ?? []) {
    if (!bannerMap[b.slot_key]) bannerMap[b.slot_key] = []
    bannerMap[b.slot_key].push(b as BannerSlot)
  }

  return { bannerMap }
}
