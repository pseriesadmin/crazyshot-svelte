import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  // 상품 목록은 인증 여부와 무관하게 로드 (레이아웃에서 인증 처리)
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const [{ data: products }, { data: rawCategoryGroups }] = await Promise.all([
    admin
      .from('products')
      .select('id, name, product_code, category, image_urls, is_active')
      .is('deleted_at', null)
      .is('parent_product_id', null)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(200),
    // PC CMS 상품목록과 동일한 카테고리 소스 — code_mapping_groups.default_category가
    // products.category 필터 키이며, show_in_product_filter=true인 그룹만 탭으로 노출
    admin
      .from('code_mapping_groups')
      .select('name, default_category, show_in_product_filter')
      .not('default_category', 'is', null)
      .eq('is_active', true)
      .eq('show_in_product_filter', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  // value = default_category (products.category 비교용 실제 필터 키)
  const categories = (rawCategoryGroups ?? []).map((g) => ({
    value: g.default_category as string,
    label: g.name as string,
  }))

  return {
    products: (products ?? []) as Array<{
      id: string
      name: string
      product_code: string | null
      category: string
      image_urls: string[]
      is_active: boolean
    }>,
    categories,
  }
}
