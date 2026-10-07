/**
 * GET   /api/cms/reservations/[id]/options/assets — 옵션상품 실물 배정 조회(필요 시 보정 배정 포함)
 * PATCH /api/cms/reservations/[id]/options/assets — 옵션상품 실물 재배정
 *
 * Migration 654(reservation_option_assets). 옵션 1행 × qty = 실물 qty건. 옵션도 부모 상품이라 같은 부모의 활성 자식 중에서 배정·재배정한다.
 * - GET: 배정이 빠진 hold·confirmed 예약은 보정 배정(cms_ensure_reservation_option_assets)을 먼저 시도한다 — 쓰기가 있으므로 manager 이상만.
 *        그 외 역할은 조회만. 반출 이후 예약은 배정하지 않는다(과거 옵션 실물 미추적).
 * - PATCH: manager 이상, 상태(hold·confirmed)·점유 규칙은 RPC가 최종 권위.
 * - 옵션 추가·수량·삭제(options/+server.ts)는 정책으로 차단돼 있고(reservationCompositionPolicy.ts) 이 경로는 재배정 전용이라 차단 대상이 아니다.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  if (hasSettingsAccess(cmsRole)) {
    // 보정 배정은 best-effort — 실패해도 조회는 계속한다
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: reservationId })
  }

  const { data, error } = await admin
    .from('reservation_option_assets')
    .select('id, reservation_option_id, option_product_id, asset:products!reservation_option_assets_asset_product_id_fkey(product_code)')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  if (error) return json({ error: error.message }, { status: 500 })

  const assets = (data ?? []).map(r => {
    const asset = Array.isArray(r.asset) ? r.asset[0] : r.asset
    return {
      id:                    r.id as number,
      reservation_option_id: r.reservation_option_id as number,
      option_product_id:     r.option_product_id as string,
      product_code:          (asset?.product_code as string | null | undefined) ?? null,
    }
  })

  return json({ assets })
}

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

  let body: { option_asset_id?: number; new_asset_id?: string }
  try {
    body = await request.json() as { option_asset_id?: number; new_asset_id?: string }
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 })
  }
  if (typeof body.option_asset_id !== 'number' || !Number.isInteger(body.option_asset_id) || body.option_asset_id <= 0) {
    return json({ error: 'option_asset_id가 필요합니다.' }, { status: 400 })
  }
  if (typeof body.new_asset_id !== 'string' || !UUID_RE.test(body.new_asset_id)) {
    return json({ error: 'new_asset_id 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_reassign_option_asset', {
    p_reservation_id:  reservationId,
    p_option_asset_id: body.option_asset_id,
    p_new_asset_id:    body.new_asset_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type ReassignResult = { success: boolean; error_message: string | null }
  const result = (data as ReassignResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}
