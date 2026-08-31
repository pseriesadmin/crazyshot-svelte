/**
 * GET  /api/cms/reservations/[id]/dhero — 두발히어로 배송상태 조회 (수동 새로고침)
 * POST /api/cms/reservations/[id]/dhero — 배송접수 / 재시도 (createDelivery)
 *
 * - CMS 관리자 전용 (getCmsRoleForAction)
 * - 두발히어로 API 호출은 fail-soft: 실패해도 400/500이 아닌 json with dhero_error
 * - 배송접수 시 print:'r' EC-4 중복방지 자동 적용
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import {
  getDeliveryByBookId,
  createDelivery,
  DHERO_STATUS_LABEL,
  DheroApiError,
} from '$lib/server/dhero'
import { maybeAutoAdvanceOnDheroDelivered } from '$lib/server/dheroAutoAdvance'
import { isBulkDeliveryMethod } from '$lib/server/isBulkDeliveryMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import type { RequestHandler } from './$types'

// ── 공통 유틸 ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// getReservationForDhero는 $lib/server/getReservationForDhero에서 공유 사용
// (cms/reservation/+page.server.ts의 updateStatus 자동 트리거와 동일 JOIN 패턴 — CRITICAL-1 수정)

// ── GET: 배송상태 조회 ─────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // RSV-B-B6: 두발히어로 배송 API는 manager 이상 전용 (partner 조회만 허용, 조작 불가)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseId(params.id)
  if (!reservationId) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const res = await getReservationForDhero(admin, reservationId)
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  // bulk-delivery 여부 확인 (컴포넌트가 UI 분기 결정에 사용)
  const isBulkDelivery = await isBulkDeliveryMethod(admin, res.pickupMethod)

  // trackingNumber 없으면 두발히어로 연동 이력 없음
  if (!res.trackingNumber) {
    return json({ dhero: null, reservation: res, is_bulk_delivery: isBulkDelivery })
  }

  // 두발히어로 API 호출 (fail-soft)
  try {
    const status = await getDeliveryByBookId(res.trackingNumber)
    // RPC로 상태 갱신 (pickup leg)
    await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: res.trackingNumber,
      p_courier_code:    '두발히어로',
      p_status:          DHERO_STATUS_LABEL[status.status] ?? String(status.status),
      p_status_code:     status.status,
      p_dong_group:      res.dheroDongGroup,
      p_meta:            status as Record<string, unknown>,
      p_return_book_id:  null,
    })

    // 배송완료(5) → pickup 방향 대여 여정 자동 전이 (fail-soft, EC-2 경쟁조건 방어 포함)
    await maybeAutoAdvanceOnDheroDelivered(
      admin,
      reservationId,
      'pickup',
      status.status,
      res.pickupMethod,
      res.returnMethod,
      res.status,
    )

    // 반납 leg: dhero_return_book_id가 있으면 반납 배송상태도 조회·전이 (fail-soft)
    if (res.dheroReturnBookId) {
      try {
        const returnStatus = await getDeliveryByBookId(res.dheroReturnBookId)
        await admin.rpc('update_reservation_dhero_shipment', {
          p_reservation_id:  reservationId,
          p_tracking_number: res.trackingNumber,
          p_courier_code:    '두발히어로',
          p_status:          DHERO_STATUS_LABEL[returnStatus.status] ?? String(returnStatus.status),
          p_status_code:     returnStatus.status,
          p_dong_group:      res.dheroDongGroup,
          p_meta:            returnStatus as Record<string, unknown>,
          p_return_book_id:  res.dheroReturnBookId,
        })
        await maybeAutoAdvanceOnDheroDelivered(
          admin,
          reservationId,
          'return',
          returnStatus.status,
          res.pickupMethod,
          res.returnMethod,
          res.status,
        )
      } catch (returnErr) {
        // 반납 leg 조회 실패는 pickup leg 결과에 영향 없음
        console.error(`[dhero GET] 반납 leg fail-soft (id=${reservationId}):`,
          returnErr instanceof Error ? returnErr.message : returnErr)
      }
    }

    return json({ dhero: status, reservation: res, is_bulk_delivery: isBulkDelivery })
  } catch (e) {
    const dheroError = e instanceof DheroApiError
      ? { message: e.message, statusCode: e.statusCode }
      : { message: e instanceof Error ? e.message : '알 수 없는 오류' }
    return json({ dhero: null, dhero_error: dheroError, reservation: res, is_bulk_delivery: isBulkDelivery })
  }
}

// ── POST: 배송접수 / 재시도 ────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseId(params.id)
  if (!reservationId) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const res = await getReservationForDhero(admin, reservationId)
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  // RSV-B-C3: 멱등성 가드 — 이미 배송 접수된 예약은 중복 접수 차단
  if (res.trackingNumber) {
    return json(
      { error: '이미 배송이 접수된 예약입니다. 두발히어로 콘솔에서 현황을 확인해주세요.' },
      { status: 409 },
    )
  }

  // bulk-delivery 방식이 아니면 두발히어로 접수 불가
  const isBulk = await isBulkDeliveryMethod(admin, res.pickupMethod)
  if (!isBulk) {
    return json({ error: '두발히어로 배송 방식이 아닙니다.' }, { status: 422 })
  }

  // 주소 필수 검증
  if (!res.address || !res.postalCode) {
    return json({ error: '배송지 주소(우편번호 포함)가 등록되지 않았습니다.' }, { status: 422 })
  }

  try {
    const deliveryRes = await createDelivery({
      receiverName:              res.customerName,
      receiverMobile:            res.customerPhone,
      receiverAddress:           res.address,
      receiverAddressDetail:     res.addressDetail,
      receiverAddressPostalCode: res.postalCode,
      productName:               res.productName,
      orderIdFromCorp:           res.reservationCode ?? String(reservationId),
      memoFromCustomer:          res.notes ?? undefined,
    })

    await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: deliveryRes.bookId,
      p_courier_code:    '두발히어로',
      p_status:          DHERO_STATUS_LABEL[0] ?? '배송접수',
      p_status_code:     0,
      p_dong_group:      deliveryRes.dongGroup ?? null,
      p_meta:            deliveryRes as Record<string, unknown>,
      p_return_book_id:  null,
    })

    return json({ ok: true, bookId: deliveryRes.bookId, dongGroup: deliveryRes.dongGroup ?? null })
  } catch (e) {
    const dheroError = e instanceof DheroApiError
      ? { message: e.message, statusCode: e.statusCode }
      : { message: e instanceof Error ? e.message : '알 수 없는 오류' }
    return json({ ok: false, dhero_error: dheroError }, { status: 502 })
  }
}
