import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'

// /products "카테고리 설정"(cms_settings['product_page_categories']) + code_mapping_groups
// 조회를 한 곳으로 통합 — /products와 상품상세(ProductHero) 양쪽이 이 함수를 공유해야
// 두 화면의 카테고리 메뉴가 항상 동일하게 유지된다(각자 인라인으로 재구현하면
// service-operations.md §11에서 이미 겪은 것과 같은 종류의 드리프트 버그가 재발할 수 있음).

export interface CatSettingsItem {
  code_id: string
  icon_key: string
  sort_order: number
  icon_url?: string | null
}

export interface CategoryGroup {
  id: string
  code: string
  name: string
  sort_order: number
}

export interface DisplayCategory {
  id: string
  code: string
  name: string
  sort_order: number
  icon_url: string | null
}

/**
 * code_mapping_groups(카테고리 체계 정본) 조회.
 * BUG-FIX(2026-08-10): RLS가 is_cms_user()로 잠겨있어 일반 고객은 anon key로 이 테이블을
 * 읽을 수 없다 — 카테고리 이름은 민감정보가 아니므로 이 조회에 한해서만 service_role
 * 사용(RLS 정책 자체는 무변경). code_mapping_groups가 카테고리 체계의 유일한 정본(Stephen 확정).
 */
export async function getCategoryGroups(): Promise<CategoryGroup[]> {
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { data: groupsRaw } = await admin
    .from('code_mapping_groups')
    .select('name, default_category, sort_order')
    .not('default_category', 'is', null)
    .eq('is_active', true)
    .eq('show_in_product_filter', true)
    .order('sort_order')

  type GroupRow = { name: string; default_category: string; sort_order: number }
  return ((groupsRaw ?? []) as GroupRow[]).map((g) => ({
    id: g.default_category,
    code: g.default_category,
    name: g.name,
    sort_order: g.sort_order,
  }))
}

/**
 * 조합코드그룹(code_mapping_groups, SSOT) 중 이름이 일치하는 그룹의 default_category("카테고리 키")를
 * 직접 조회. getCategoryGroups()와 달리 is_active/show_in_product_filter 조건 없이 조회 —
 * 화면 노출 여부와 무관하게 항상 정확한 카테고리 키가 필요한 서버측 검색 제한(예: hype-pack
 * 배너 상품검색을 "패키지" 카테고리로만 잠그는 용도)에 사용.
 */
export async function getCategoryKeyByGroupName(name: string): Promise<string | null> {
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { data } = await admin
    .from('code_mapping_groups')
    .select('default_category')
    .eq('name', name)
    .not('default_category', 'is', null)
    .maybeSingle()
  return (data as { default_category: string } | null)?.default_category ?? null
}

/** catItems(저장된 순서·아이콘) + groups(정본 라벨)를 조인해 화면 표시용 목록으로 변환 */
export function joinDisplayCategories(catItems: CatSettingsItem[], groups: CategoryGroup[]): DisplayCategory[] {
  return [...catItems]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((item) => {
      const group = groups.find((g) => g.id === item.code_id)
      if (!group) return []
      return [{
        id: group.id,
        code: group.code,
        name: group.name,
        sort_order: item.sort_order,
        icon_url: item.icon_url ?? null,
      }]
    })
}
