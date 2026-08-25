/**
 * PUT /api/cms/reservations/[id]/dhero/cancel — 두발히어로 배송 취소 (관리자 수동)
 *
 * - 취소 가능 범위: 접수~배송배차(상태코드 0~3). 출발 이후는 412 반환.
 * - fail-soft 아님 — 이 엔드포인트는 관리자가 의도적으로 취소하는 동작이라
 *   실패 시 에러를 그대로 클라이언트에 전달한다(RentalDetailPanel이 경고 노출).
 * - 예약 status 자체는 변경하지 않음 (별도 updateStatus 액션으로만 변경).
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { cancelDelivery, DheroApiError } from '$lib/server/dhero'
import type { RequestHandler } from './$types'

export const PUT: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // tracking_number 조회
  const { data: resRow } = await admin
    .from('rental_reservations')
    .select('tracking_number')
    .eq('id', reservationId)
    .maybeSingle()

  const trackingNumber = (resRow as Record<string, unknown> | null)?.tracking_number as string | null
  if (!trackingNumber) {
    return json({ error: '운송장 번호가 없습니다. 배송접수 후 취소가 가능합니다.' }, { status: 422 })
  }

  try {
    await cancelDelivery(trackingNumber)
    return json({ ok: true })
  } catch (e) {
    if (e instanceof DheroApiError) {
      if (e.statusCode === 412) {
        return json({
          ok: false,
          dhero_cancel_failed: true,
          message: '이미 배송이 시작돼 두발히어로에서 취소할 수 없습니다. 직접 연락이 필요합니다.',
        }, { status: 422 })
      }
      return json({ ok: false, message: e.message }, { status: 502 })
    }
    return json({ ok: false, message: '두발히어로 API 연결에 실패했습니다.' }, { status: 502 })
  }
}
