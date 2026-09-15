import type { SupabaseClient } from '@supabase/supabase-js'

type OrderedProductRef = { id: string; order: number }
type MdPicksValue = { products: OrderedProductRef[]; mode: 'random' | 'fixed' }
type CategoryProductsValue = {
  items: { category_id: string; products: OrderedProductRef[]; mode: 'random' | 'fixed' }[]
}
type ThemeGroupRow = {
  id: string
  title: string
  sub_copy: string | null
  image_url: string
  product_ids: OrderedProductRef[]
  sort_order: number
}

/**
 * 상품이 실제로 삭제(soft-delete)될 때, 그 상품이 등록돼 있던 홈 화면 큐레이션 설정
 * 3곳(추천상품·카테고리 상품 큐레이션·취향직격 테마그룹)에서 해당 참조만 제거한다.
 * 호출부(deleteProduct 액션)와 동일한 세션 클라이언트를 받아야 한다 — upsert_product_page_setting/
 * cms_update_theme_group RPC가 is_cms_user()(auth.uid() 기준)를 검사하므로 service_role
 * 클라이언트로는 통과하지 못한다.
 */
export async function removeProductFromHomeCuration(
  supabase: SupabaseClient,
  productId: string
): Promise<void> {
  const { data: mdRow } = await supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'product_page_md_picks')
    .maybeSingle()
  const mdVal = (mdRow as { value: MdPicksValue } | null)?.value
  if (mdVal?.products?.some((p) => p.id === productId)) {
    const { error } = await supabase.rpc('upsert_product_page_setting', {
      p_key: 'product_page_md_picks',
      p_value: { ...mdVal, products: mdVal.products.filter((p) => p.id !== productId) },
    })
    if (error) throw new Error(`product_page_md_picks 정리 실패: ${error.message}`)
  }

  const { data: catRow } = await supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'home_category_products')
    .maybeSingle()
  const catVal = (catRow as { value: CategoryProductsValue } | null)?.value
  if (catVal?.items?.some((it) => it.products.some((p) => p.id === productId))) {
    const { error } = await supabase.rpc('upsert_product_page_setting', {
      p_key: 'home_category_products',
      p_value: {
        items: catVal.items.map((it) => ({
          ...it,
          products: it.products.filter((p) => p.id !== productId),
        })),
      },
    })
    if (error) throw new Error(`home_category_products 정리 실패: ${error.message}`)
  }

  const { data: groups } = await supabase
    .from('home_theme_groups')
    .select('id, title, sub_copy, image_url, product_ids, sort_order')
    .is('deleted_at', null)
  for (const g of (groups ?? []) as ThemeGroupRow[]) {
    if (g.product_ids?.some((p) => p.id === productId)) {
      const { error } = await supabase.rpc('cms_update_theme_group', {
        p_id: g.id,
        p_title: g.title,
        p_sub_copy: g.sub_copy,
        p_image_url: g.image_url,
        p_product_ids: g.product_ids.filter((p) => p.id !== productId),
        p_sort_order: g.sort_order,
      })
      if (error) throw new Error(`home_theme_groups(${g.id}) 정리 실패: ${error.message}`)
    }
  }
}
