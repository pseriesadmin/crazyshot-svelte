/**
 * GET /api/cms/reservations/[id]/options/assets/available?option_asset_id=<number>
 *
 * 이 예약의 옵션상품 실물 배정 한 줄을 교체할 수 있는 "같은 옵션상품의 빈 실물" 목록(Migration 654).
 * 점유 판정은 DB 함수 하나(cms_list_option_asset_candidates → private.option_unit_is_free)가 하고,
 * 교체 RPC(cms_reassign_option_asset)도 같은 함수를 쓰므로 화면 후보와 교체 결과가 어긋나지 않는다.
 * 응답: { units: [{ id, product_code }] } — 품번 숫자 인식 오름차순. manager 이상 전용.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sortUnitsByCode } from '$lib/utils/availableUnitOrder'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }
  const optionAssetId = Number(url.searchParams.get('option_asset_id'))
  if (!Number.isInteger(optionAssetId) || optionAssetId <= 0) {
    return json({ error: 'option_asset_id가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_list_option_asset_candidates', {
    p_reservation_id:  reservationId,
    p_option_asset_id: optionAssetId,
  })
  if (error) return json({ error: error.message }, { status: 500 })

  const units = sortUnitsByCode(
    ((data ?? []) as Array<{ id: string; product_code: string | null }>).map(u => ({ id: u.id, product_code: u.product_code })),
  )
  return json({ units })
}
