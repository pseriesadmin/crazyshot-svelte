/**
 * PUT /api/cms/reservations/[id]/dhero/cancel — 두발히어로 배송 취소 (관리자 수동)
 *
 * - 취소 가능 범위: 접수~배송배차(상태코드 0~3). 출발 이후는 412 반환.
 * - fail-soft 아님 — 이 엔드포인트는 관리자가 의도적으로 취소하는 동작이라
 *   실패 시 에러를 그대로 클라이언트에 전달한다(RentalDetailPanel이 경고 노출).
 * - 주문(예약코드) 1건 = 배송 1건: 취소는 한 번만 호출하고, 같은 접수번호를 가진 같은 주문의 상품 전부의 운송장을 초기화한다.
 * - 예약 status 자체는 변경하지 않음 (별도 updateStatus 액션으로만 변경).
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { cancelDelivery, DheroApiError } from '$lib/server/dhero'
import { listSameBookReservationIds, isDheroBooking } from '$lib/server/dheroOrderUnits'
import { isAlreadyCanceledError } from '$lib/server/dheroCancelErrors'
import type { RequestHandler } from './$types'

export const PUT: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  // RSV-B-B6: 두발히어로 배송 취소는 manager 이상 전용
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // tracking_number + courier_code 조회
  const { data: resRow } = await admin
    .from('rental_reservations')
    .select('tracking_number, courier_code')
    .eq('id', reservationId)
    .maybeSingle()

  const trackingNumber = (resRow as Record<string, unknown> | null)?.tracking_number as string | null
  if (!trackingNumber) {
    return json({ error: '운송장 번호가 없습니다. 배송접수 후 취소가 가능합니다.' }, { status: 422 })
  }

  // courier_code 가드: 두발히어로가 아닌 타 택배사 운송장이면 API 호출 없이 건너뜀 (P3-2)
  const courierCode = (resRow as Record<string, unknown> | null)?.courier_code as string | null | undefined
  if (!isDheroBooking(courierCode)) {
    return json({ ok: true, dhero_skipped: true })
  }

  try {
    await cancelDelivery(trackingNumber)
    // RSV-B-C4: 취소 성공 후 tracking_number NULL 초기화 (fail-soft)
    // clear_reservation_tracking_number RPC(Migration 403) — 재접수 가능 상태로 되돌림.
    // 실패해도 취소 자체는 이미 완료됐으므로 ok:true 응답 유지.
    try {
      for (const id of await listSameBookReservationIds(admin, reservationId, trackingNumber)) {
        await admin.rpc('clear_reservation_tracking_number', { p_reservation_id: id })
      }
    } catch (rpcErr) {
      console.error('[dhero/cancel] tracking_number 초기화 RPC 실패(fail-soft):', rpcErr instanceof Error ? rpcErr.message : rpcErr)
    }
    return json({ ok: true })
  } catch (e) {
    if (e instanceof DheroApiError) {
      if (e.statusCode === 412 && isAlreadyCanceledError(e)) {
        // (a) 이미 취소된 배송 — 성공에 준하게 처리 (dhero-delivery-api.md §5)
        // 두발히어로 쪽에서 이미 취소된 것이므로 tracking_number 초기화(재접수 가능 상태로 복원).
        // fail-soft: 초기화 실패 시에도 ok:true 유지 (취소 자체는 이미 완료 상태)
        try {
          for (const id of await listSameBookReservationIds(admin, reservationId, trackingNumber)) {
            await admin.rpc('clear_reservation_tracking_number', { p_reservation_id: id })
          }
        } catch (rpcErr) {
          console.error('[dhero/cancel] already-canceled tracking_number 초기화 RPC 실패(fail-soft):', rpcErr instanceof Error ? rpcErr.message : rpcErr)
        }
        return json({ ok: true, already_canceled: true })
      }
      if (e.statusCode === 412) {
        // (b) 취소 불가 상태(배송 출발·완료 등) 또는 메시지 불명확 → fail-safe: 취소불가로 처리
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
