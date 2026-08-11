import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
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
    id:   g.default_category,
    code: g.default_category,
    name: g.name,
  }))

  return { bannerMap, isCms, categories }
}
