/**
 * POST /api/cms/reservations/[id]/dhero/return — 두발히어로 반품 등록 (관리자 수동)
 *
 * - 같은 bookId로 복수 반품 접수 가능 (R, 1R, 2R 순차)
 * - 취소/사고/분실완료 상태는 반품 불가 (두발히어로 API가 에러 반환)
 * - RPC로 dhero_return_book_id 갱신
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { registerReturn, DHERO_STATUS_LABEL, DheroApiError } from '$lib/server/dhero'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, locals }) => {
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
    return json({ error: '운송장 번호가 없습니다. 배송접수 후 반품등록이 가능합니다.' }, { status: 422 })
  }

  try {
    const returnRes = await registerReturn(trackingNumber)

    await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: trackingNumber,
      p_courier_code:    '두발히어로',
      p_status:          DHERO_STATUS_LABEL[0] ?? '반품접수',
      p_status_code:     0,
      p_dong_group:      returnRes.dongGroup ?? null,
      p_meta:            returnRes as Record<string, unknown>,
      p_return_book_id:  returnRes.bookId,
    })

    return json({ ok: true, returnBookId: returnRes.bookId, dongGroup: returnRes.dongGroup ?? null })
  } catch (e) {
    if (e instanceof DheroApiError) {
      return json({ ok: false, message: e.message }, { status: 502 })
    }
    return json({ ok: false, message: '두발히어로 API 연결에 실패했습니다.' }, { status: 502 })
  }
}
