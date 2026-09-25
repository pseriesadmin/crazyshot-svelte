import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// 예약 시점에 배정된 결합상품 실물 조회(reservation_bundle_assets, 결합상품 Phase 2).
// RentalDetailPanel "대여정보" 탭의 "결합상품" 섹션이 options API와 동일한 lazy-fetch 패턴으로 사용.
// 조회 전용(권한은 options GET과 동일 — CMS 세션 역할만 확인). 배정 기록이 없으면 빈 배열.
export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('reservation_bundle_assets')
    .select('id, asset:products!reservation_bundle_assets_asset_product_id_fkey(product_code), bundle:products!reservation_bundle_assets_bundle_product_id_fkey(name)')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  if (error) return json({ error: error.message }, { status: 500 })

  const bundles = (data ?? []).map(r => {
    const asset  = Array.isArray(r.asset)  ? r.asset[0]  : r.asset
    const bundle = Array.isArray(r.bundle) ? r.bundle[0] : r.bundle
    return {
      id:           r.id as number,
      bundle_name:  (bundle?.name as string | undefined) ?? '-',
      product_code: (asset?.product_code as string | null | undefined) ?? null,
    }
  })

  return json({ bundles })
}
