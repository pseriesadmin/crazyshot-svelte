/**
 * GET /api/chat/shipment-tracking/[id]
 * 예약의 운송장 번호·택배사 코드 + 배송 추적 상태를 반환
 *
 * 접근 허용: CMS 관리자(getCmsRoleForAction) 또는 해당 예약의 소유 고객(session.user.id)
 * — /api/chat/reservation-status/[id]와 동일한 소유권 검증 패턴 사용
 *
 * 조회는 service_role(RLS 우회)로 수행하고, 접근 가능 여부는 애플리케이션 코드에서 명시적으로
 * 검증한다 — rental_reservations RLS는 소유 고객만 SELECT를 허용해 locals.supabase로는 관리자가
 * 다른 고객의 예약을 조회할 수 없으므로(기존 CMS 조회부와 동일 패턴).
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { getTrackingStatus } from '$lib/server/courierTracking'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')

  const cmsRole = await getCmsRoleForAction(locals)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: reservation, error: resErr } = await admin
    .from('rental_reservations')
    .select('user_id, tracking_number, courier_code')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !reservation) throw error(404, '예약을 찾을 수 없습니다.')

  const r = reservation as { user_id: string; tracking_number: string | null; courier_code: string | null }

  // 소유권 검증 — CMS 관리자 또는 해당 예약의 고객만 접근 가능
  const isOwner = r.user_id === session.user.id
  if (!cmsRole && !isOwner) throw error(403, '접근 권한이 없습니다.')

  const trackingStatus = await getTrackingStatus(r.courier_code, r.tracking_number)

  return json({
    tracking_number: r.tracking_number ?? null,
    courier_code: r.courier_code ?? null,
    tracking_status: trackingStatus,
  })
}
