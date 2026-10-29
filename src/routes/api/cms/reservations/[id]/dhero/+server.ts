/**
 * GET  /api/cms/reservations/[id]/dhero — 두발히어로 배송상태 조회 (수동 새로고침)
 * POST /api/cms/reservations/[id]/dhero — 배송접수 / 재시도 (createDelivery) — 예약코드(주문) 1건 = 배송 1건: 같은 주문의 상품 전부를 한 건으로 접수하고 접수번호를 전부에 저장
 *
 * - CMS 관리자 전용 (getCmsRoleForAction)
 * - 두발히어로 API 호출은 fail-soft: 실패해도 400/500이 아닌 json with dhero_error
 * - 배송접수 시 print:'r' EC-4 중복방지 자동 적용
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
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
  type DheroDeliveryStatus,
} from '$lib/server/dhero'
import { dheroStatusLabel, liveDheroBookings } from '$lib/utils/dheroLabels'
import { maybeAutoAdvanceOnDheroDelivered } from '$lib/server/dheroAutoAdvance'
import { isDheroIntegrationMethod } from '$lib/server/isDheroIntegrationMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { pickDeliveryMemo } from '$lib/server/dheroMemo'
import { notifyTrackingRegistered } from '$lib/server/notifyTrackingRegistered'
import { fetchReturnLegForDisplay } from '$lib/server/dheroReturnLegDisplay'
import { listOrderReservationIds, joinProductNames, isDheroBooking } from '$lib/server/dheroOrderUnits'
import type { RequestHandler } from './$types'

// ── 공통 유틸 ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 패널이 반납중 단계 계산에 쓰는 필드만 — 기사 이름·연락처·링크 등은 응답에 싣지 않는다 */
interface ReturnLegForPanel {
  bookId:      string
  status:      number
  statusText:  string | null
  canceledAt:  string | null
  accidentAt:  string | null
}

function pickReturnLegForPanel(s: DheroDeliveryStatus): ReturnLegForPanel {
  return {
    bookId:     s.bookId,
    status:     s.status,
    statusText: typeof s.statusText === 'string' ? s.statusText : null,
    canceledAt: typeof s.canceledAt === 'string' ? s.canceledAt : null,
    accidentAt: typeof s.accidentAt === 'string' ? s.accidentAt : null,
  }
}

// getReservationForDhero는 $lib/server/getReservationForDhero에서 공유 사용
// (cms/reservation/+page.server.ts의 updateStatus 자동 트리거와 동일 JOIN 패턴 — CRITICAL-1 수정)

type DheroAdminClient = Parameters<typeof maybeAutoAdvanceOnDheroDelivered>[0] & {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>
}

// 반납 leg 조회·저장·전이 (fail-soft). 반출 leg 조회 성패와 무관하게 수행한다 — 반출 조회가 일시 실패해도
// 반납중 단계 표시는 유지되도록 반출 try 블록 밖에 둔다. 조회는 8초 상한(fetchReturnLegForDisplay)이 걸려 패널 응답을 오래 붙잡지 않는다.
async function loadReturnLeg(
  admin: DheroAdminClient,
  reservationId: number,
  res: NonNullable<Awaited<ReturnType<typeof getReservationForDhero>>>,
): Promise<ReturnLegForPanel | null> {
  if (!res.dheroReturnBookId) return null
  const returnStatus = await fetchReturnLegForDisplay(res.dheroReturnBookId, res.courierCode)
  if (!returnStatus) return null
  try {
    await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: res.trackingNumber,
      p_courier_code:    '두발히어로',
      p_status:          dheroStatusLabel(returnStatus),
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
    // 저장·전이 실패는 표시에 영향 없음 — 조회한 값은 그대로 보여준다
    console.error(`[dhero GET] 반납 leg 저장 fail-soft (id=${reservationId}):`,
      returnErr instanceof Error ? returnErr.message : returnErr)
  }
  return pickReturnLegForPanel(returnStatus)
}

// ── GET: 배송상태 조회 ─────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  // RSV-B-B6: 두발히어로 배송 API는 manager 이상 전용 (partner 조회만 허용, 조작 불가)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseId(params.id)
  if (!reservationId) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const res = await getReservationForDhero(admin, reservationId)
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  // 응답 최소화 — 공동현관 출입번호는 패널이 이 응답에서 읽지 않으므로 내려주지 않는다(request-notes 가 manager 이상에게만 별도 제공, sp5 LOW)
  const resPublic = { ...res, frontdoorPassword: null }

  // 두발히어로 연동 대상 방식 여부 확인(is_dhero_integration — 컴포넌트가 UI 분기 결정에 사용)
  const isDheroIntegration = await isDheroIntegrationMethod(admin, res.pickupMethod)

  // trackingNumber 없거나 두발히어로 택배사가 아니면 dhero API 건너뜀 (P3-2: 타 택배사 수동 입력 방어)
  if (!res.trackingNumber || !isDheroBooking(res.courierCode)) {
    return json({ dhero: null, reservation: resPublic, is_dhero_integration: isDheroIntegration })
  }

  // 두발히어로 API 호출 (fail-soft)
  try {
    const status = await getDeliveryByBookId(res.trackingNumber)
    // RPC로 상태 갱신 (pickup leg)
    await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: res.trackingNumber,
      p_courier_code:    '두발히어로',
      p_status:          dheroStatusLabel(status),
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

    const returnDhero = await loadReturnLeg(admin, reservationId, res)
    return json({ dhero: status, returnDhero, reservation: resPublic, is_dhero_integration: isDheroIntegration })
  } catch (e) {
    const dheroError = e instanceof DheroApiError
      ? { message: e.message, statusCode: e.statusCode }
      : { message: e instanceof Error ? e.message : '알 수 없는 오류' }
    const returnDhero = await loadReturnLeg(admin, reservationId, res)
    return json({ dhero: null, dhero_error: dheroError, returnDhero, reservation: resPublic, is_dhero_integration: isDheroIntegration })
  }
}

// ── POST: 배송접수 / 재시도 ────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseId(params.id)
  if (!reservationId) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const res = await getReservationForDhero(admin, reservationId)
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  // 같은 주문(예약코드)의 다른 상품 — 배송은 주문당 1건으로 접수한다(상품명 합침·접수번호 전부 저장)
  const orderIds = await listOrderReservationIds(admin, reservationId)
  const others = (await Promise.all(orderIds.filter((id) => id !== reservationId).map((id) => getReservationForDhero(admin, id).catch(() => null))))
    .filter((r): r is NonNullable<typeof r> => r != null)

  // RSV-B-C3: 멱등성 가드 — 주문의 어느 상품에든 접수번호가 이미 있으면 중복 접수 차단
  // 두발히어로 쪽에서 이미 취소된 접수(dhero_meta.canceledAt)는 재접수를 막지 않는다(createDelivery 가 `예약코드-N` 새 번호로 접수).
  // 접수 1건은 형제 예약이 공유하므로 같은 접수번호 중 하나라도 취소로 기록돼 있으면 그 접수 전체를 취소로 본다(liveDheroBookings)
  if (liveDheroBookings([res, ...others]).length > 0) {
    return json(
      { error: '이미 배송이 접수된 예약입니다. 두발히어로 콘솔에서 현황을 확인해주세요.' },
      { status: 409 },
    )
  }

  // 두발히어로 연동 대상 방식이 아니면 접수 불가
  const isDheroOn = await isDheroIntegrationMethod(admin, res.pickupMethod)
  if (!isDheroOn) {
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
      productName:               joinProductNames([res.productName, ...others.map((o) => o.productName)]),
      orderIdFromCorp:           res.reservationCode ?? String(reservationId),
      memoFromCustomer:          pickDeliveryMemo(res),
      frontdoorPassword:         res.frontdoorPassword ?? undefined,
    })

    for (const id of orderIds) {
      await admin.rpc('update_reservation_dhero_shipment', {
        p_reservation_id:  id,
        p_tracking_number: deliveryRes.bookId,
        p_courier_code:    '두발히어로',
        p_status:          DHERO_STATUS_LABEL[0] ?? '배송접수',
        p_status_code:     0,
        p_dong_group:      deliveryRes.dongGroup ?? null,
        p_meta:            deliveryRes as Record<string, unknown>,
        p_return_book_id:  null,
      })
    }

    // 운송장(접수번호) 저장 직후 고객에게 택배사·운송장 번호 안내(주문당 1회·대표 예약, fail-soft, 2026-10-27)
    await notifyTrackingRegistered(admin, reservationId)

    return json({ ok: true, bookId: deliveryRes.bookId, dongGroup: deliveryRes.dongGroup ?? null })
  } catch (e) {
    const dheroError = e instanceof DheroApiError
      ? { message: e.message, statusCode: e.statusCode }
      : { message: e instanceof Error ? e.message : '알 수 없는 오류' }
    return json({ ok: false, dhero_error: dheroError }, { status: 502 })
  }
}
