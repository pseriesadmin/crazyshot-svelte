import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// GET /api/cms/products/[id]/option-links
//
// 목적: RentalDetailPanel "옵션상품 추가" 클릭 시, 이 예약의 메인상품에 이미 등록 시점부터
// 연동돼 있는 "옵션상품"(product_option_links — 카탈로그 수준 설정, 고객 상세페이지가 예약 시
// 보여주는 것과 동일한 목록)을 우선 제안하기 위함(2026-09-03, Stephen 지시 — "기본상품과
// 연동된 옵션 상품 목록이 노출되는 것이 정합적인 UX").
//
// [id]는 부모/자식 어느 쪽이든 받는다 — rental_reservations.product_id는 항상 자식(실물
// 재고단위) id이므로, 여기서 parent_product_id를 먼저 해석한다(src/lib/server/products/
// loadSelectedProductDetail.ts의 policySourceId 해석과 동일 원칙). 부모 id가 그대로 들어오면
// (parent_product_id가 NULL) 그 id 자신을 그대로 쓴다.
//
// get_product_option_links RPC는 이미 이 프로젝트 전역에서 "product_id → 연동 옵션상품
// 해석"의 유일한 정본 경로다(고객 상세페이지·CMS 상품 상세패널이 전부 이 RPC를 씀) — 여기서도
// 동일 RPC를 그대로 재사용하고, product_option_links 테이블을 직접 조인하지 않는다.
export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const productId = params.id
  if (!productId) return json({ error: '잘못된 상품 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: productRow, error: productErr } = await admin
    .from('products')
    .select('parent_product_id')
    .eq('id', productId)
    .maybeSingle()

  if (productErr) return json({ error: productErr.message }, { status: 500 })
  if (!productRow) return json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 })

  const resolvedParentId = (productRow as { parent_product_id: string | null }).parent_product_id ?? productId

  const { data: links, error: rpcErr } = await admin.rpc('get_product_option_links', {
    p_product_id: resolvedParentId,
  })

  if (rpcErr) return json({ error: rpcErr.message }, { status: 500 })

  type OptionLinkRow = {
    option_product_id: string
    option_product_name: string
    price_24h: number | null
    image_url: string | null
    is_required: boolean
  }

  const options = ((links ?? []) as OptionLinkRow[]).map((l) => ({
    id: l.option_product_id,
    name: l.option_product_name,
    image_url: l.image_url,
    price_24h: l.price_24h,
    is_required: l.is_required,
  }))

  return json({ options })
}
