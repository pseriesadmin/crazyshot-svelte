/**
 * POST  /api/cms/reservations/[id]/products — 메인상품 유닛 추가
 * DELETE /api/cms/reservations/[id]/products — 메인상품 유닛 소프트 취소
 * PATCH  /api/cms/reservations/[id]/products — 상품코드(실물 재고단위) 재배정
 *
 * - manager 이상 전용 (getCmsRoleForAction + hasSettingsAccess)
 * - 전부 service_role admin 클라이언트로 호출 (Migration 428/430 — GRANT EXECUTE TO service_role)
 * - RPC error_message는 그대로 400으로 클라이언트에 전달 (구조화된 실패 사유 노출)
 * - 게이트(status='hold' AND payment_confirmed_at IS NULL) 재검증은 RPC 내부에서 처리 —
 *   클라이언트 상태를 믿지 않고 서버가 최종 권위.
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

function parseReservationId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ── POST: 메인상품 유닛 추가 ───────────────────────────────────────────────────

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseReservationId(params.id)
  if (!reservationId) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  const body = await request.json() as { product_id?: string }
  if (!body.product_id) return json({ error: 'product_id가 필요합니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_add_reservation_product_unit', {
    p_reservation_id: reservationId,
    p_product_id:     body.product_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type AddUnitResult = { success: boolean; new_reservation_id: number | null; error_message: string | null }
  const result = (data as AddUnitResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true, new_reservation_id: result.new_reservation_id })
}

// ── DELETE: 메인상품 유닛 소프트 취소 ─────────────────────────────────────────

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseReservationId(params.id)
  if (!reservationId) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  const body = await request.json() as { target_reservation_id?: number }
  if (!body.target_reservation_id || !Number.isInteger(body.target_reservation_id) || body.target_reservation_id <= 0) {
    return json({ error: 'target_reservation_id가 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_remove_reservation_product_unit', {
    p_target_reservation_id: body.target_reservation_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type RemoveUnitResult = { success: boolean; error_message: string | null }
  const result = (data as RemoveUnitResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}

// ── PATCH: 상품코드(실물 재고단위) 재배정 ─────────────────────────────────────

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseReservationId(params.id)
  if (!reservationId) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  const body = await request.json() as { new_unit_id?: string }
  if (!body.new_unit_id) return json({ error: 'new_unit_id가 필요합니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_reassign_reservation_product_code', {
    p_reservation_id: reservationId,
    p_new_unit_id:    body.new_unit_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type ReassignResult = { success: boolean; error_message: string | null }
  const result = (data as ReassignResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}
