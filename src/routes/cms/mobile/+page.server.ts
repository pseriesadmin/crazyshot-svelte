import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { loadMobileTotalCounts, todayKst } from '$lib/server/cms/mobileDashboard'
import type { PageServerLoad } from './$types'

// 현장앱 첫 화면 = 대시보드. 카테고리 버튼(상품목록 이동용)과 '현재까지' 통합 건수와 오늘 날짜를 내려준다 — 날짜를 고르면 화면이 API로 그 날짜 건수를 다시 불러온다.
// 상품 목록 자체는 /cms/mobile/products 가 불러온다.
export const load: PageServerLoad = async () => {
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const date = todayKst()

  const [{ data: rawCategoryGroups }, counts] = await Promise.all([
    admin
      .from('code_mapping_groups')
      .select('name, default_category, show_in_product_filter')
      .not('default_category', 'is', null)
      .eq('is_active', true)
      .eq('show_in_product_filter', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    loadMobileTotalCounts(admin),
  ])

  const categories = (rawCategoryGroups ?? []).map((g) => ({
    value: g.default_category as string,
    label: g.name as string,
  }))

  return { categories, date, counts }
}
