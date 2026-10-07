import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 예약 시점에 배정된 결합상품 실물 조회(reservation_bundle_assets, 결합상품 Phase 2).
// RentalDetailPanel "대여정보" 탭의 "결합상품" 섹션이 options API와 동일한 lazy-fetch 패턴으로 사용.
// GET: 조회 전용(권한은 options GET과 동일 — CMS 세션 역할만 확인). 배정 기록이 없으면 빈 배열.
// PATCH: 결합상품 실물 재배정(Migration 652) — manager 이상, 나머지 규칙(상태·점유)은 RPC가 최종 권위.
export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('reservation_bundle_assets')
    .select('id, bundle_product_id, asset:products!reservation_bundle_assets_asset_product_id_fkey(product_code), bundle:products!reservation_bundle_assets_bundle_product_id_fkey(name)')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  if (error) return json({ error: error.message }, { status: 500 })

  const bundles = (data ?? []).map(r => {
    const asset  = Array.isArray(r.asset)  ? r.asset[0]  : r.asset
    const bundle = Array.isArray(r.bundle) ? r.bundle[0] : r.bundle
    return {
      id:                r.id as number,
      bundle_product_id: r.bundle_product_id as string,
      bundle_name:  (bundle?.name as string | undefined) ?? '-',
      product_code: (asset?.product_code as string | null | undefined) ?? null,
    }
  })

  return json({ bundles })
}

// ── PATCH: 결합상품 실물 재배정 ───────────────────────────────────────────────

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  let body: { bundle_product_id?: string; new_asset_id?: string }
  try {
    body = await request.json() as { bundle_product_id?: string; new_asset_id?: string }
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!body.bundle_product_id || !body.new_asset_id) {
    return json({ error: 'bundle_product_id와 new_asset_id가 필요합니다.' }, { status: 400 })
  }
  if (!UUID_RE.test(body.bundle_product_id) || !UUID_RE.test(body.new_asset_id)) {
    return json({ error: 'bundle_product_id 또는 new_asset_id 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_reassign_bundle_asset', {
    p_reservation_id:    reservationId,
    p_bundle_product_id: body.bundle_product_id,
    p_new_asset_id:      body.new_asset_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type ReassignResult = { success: boolean; error_message: string | null }
  const result = (data as ReassignResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}
