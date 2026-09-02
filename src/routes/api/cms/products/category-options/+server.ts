import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// GET /api/cms/products/category-options
//
// 실제 등록된 상품(products.category, 부모만)에 현재 쓰이고 있는 카테고리 값만 반환한다 —
// products.category는 원래 고정 9종 Postgres ENUM(product_category_enum, Migration 02)이었으나
// 이후 어느 시점에 그 ENUM 타입 자체가 제거되고 순수 TEXT 컬럼으로 바뀌어 있음을 stage DB
// 직접 조회로 확인(2026-09-03) — 즉 카테고리 값 자체에 고정된 값집합이 원천적으로 없다. 그래서
// 이 엔드포인트는 "실제 등록 상품이 현재 쓰고 있는 값"만 DISTINCT로 뽑아 검색 필터에 넘겨도
// 항상 매칭이 보장되도록 한다. 라벨(한글 표시명)은 code_mapping_groups.default_category ↔ name
// 매핑을 재사용해 채우되(/cms/products와 동일 정본 — 2026-08-10 Stephen 확정), 매칭되는 그룹이
// 없으면 원본 값을 그대로 라벨로 폴백한다.
//
// 이 엔드포인트를 신설한 이유: ReservationProductFinderModal.svelte가 카테고리 목록을
// $lib/utils/productCategoryTaxonomy.ts의 정적 9종 배열(이후 삭제됨)에서 가져오고 있었는데,
// 이 배열은 code_mapping_groups가 자유 개명 가능해진 시점(Migration 101)부터 실제 운영
// 데이터와 계속 어긋나 왔다(Migration 240 참고 — 다른 화면에서 같은 정적 소스로 인해 발생한
// 실제 버그 사례). code_mapping_groups.default_category를 그대로 신뢰하지 않은 이유: 이 컬럼은
// 구독 등 다른 도메인에서도 자유 문자열로 쓰여(membership/used-item/partner 등) 실제 등록
// 상품에 쓰이는 값과 항상 일치하지 않는다 — 그 값을 그대로 검색 필터에 넘기면 결과가 0건으로
// 조용히 깨진다. 그래서 "실제 등록된 상품이 쓰고 있는 값"만 기준으로 삼는다.
export const GET: RequestHandler = async ({ locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const [{ data: productRows, error: productErr }, { data: groupRows, error: groupErr }] = await Promise.all([
    admin
      .from('products')
      .select('category')
      .is('parent_product_id', null)
      .is('deleted_at', null)
      .eq('is_active', true),
    admin
      .from('code_mapping_groups')
      .select('default_category, name')
      .not('default_category', 'is', null)
      .eq('is_active', true),
  ])

  if (productErr) return json({ error: productErr.message }, { status: 500 })
  if (groupErr) return json({ error: groupErr.message }, { status: 500 })

  const labelByCategory: Record<string, string> = Object.fromEntries(
    (groupRows ?? [])
      .filter((g) => g.default_category)
      .map((g) => [g.default_category as string, g.name as string])
  )

  const distinctCategories = [...new Set(
    (productRows ?? [])
      .map((p) => p.category as string | null)
      .filter((v): v is string => !!v)
  )].sort((a, b) => a.localeCompare(b))

  const categories = distinctCategories.map((value) => ({
    value,
    label: labelByCategory[value] ?? value,
  }))

  return json({ categories })
}
