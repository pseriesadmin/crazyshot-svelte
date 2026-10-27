import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { notifyTrackingRegistered } from '$lib/server/notifyTrackingRegistered'
import { requestIdentityDocRegistration } from '$lib/server/identityDocRequest'
import { getDocGateStatus, type DocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { clearIssuedContractContent, discardSentContract, cancelIssuedContract } from '$lib/server/clearIssuedContractHelper'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { createDelivery, cancelDelivery, registerReturn, DheroApiError, DHERO_STATUS_LABEL } from '$lib/server/dhero'
import { liveDheroBookings } from '$lib/utils/dheroLabels'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'
import { isDheroIntegrationMethod } from '$lib/server/isDheroIntegrationMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { pickDeliveryMemo } from '$lib/server/dheroMemo'
import { awardOnTimeReturnPoints } from '$lib/server/awardOnTimeReturnPoints'
import { tossPaymentCancel } from '$lib/server/tossPaymentCancel'
import { rpcRetryWithFailSoftLog } from '$lib/server/rpcRetryWithFailSoftLog'
import { autoIssueContractOnApproval, hasAutoIssueTemplate, type AutoIssueResult } from '$lib/server/contractAutoIssue'
import { listOrderReservationIds, joinProductNames, isDheroBooking } from '$lib/server/dheroOrderUnits'
import { isAlreadyCanceledError } from '$lib/server/dheroCancelErrors'
import { planOrderTransition, ORDER_LIFECYCLE_TARGETS, type OrderUnit } from '$lib/utils/orderStatusTransition'

export interface RentalListRow {
  /** 고객이 취소했고 관리자 취소확인 전("예약취소" 배지·헤더 [예약취소]=취소확인) — /cms/rentals 로더가 부착 */
  cancel_pending?:   boolean
  /** CS 사전 이슈 접수 건(has_prior_issue) — /cms/rentals 로더가 부착([사전접수건] 배지) */
  prior_issue?:      boolean
  /** '반납중' 칩의 반납 진행 단계 — /cms/rentals 로더가 부착(attachReturnStage) */
  return_stage?:     'notice_due' | 'notice_sent' | 'registered'
  reservation_id:    number
  reservation_code:  string | null
  status:            string
  rental_start:      string
  rental_end:        string
  rental_days:       number | null
  /** "대여일수" 표시 라벨(예: "12시간"·"1일"·"1일 12시간") — attachRentalDaysLabel()가 채움.
      rental_days(GENERATED, end_date-start_date 단순 캘린더 일수차) 대신 이 필드를 화면에 쓸 것 */
  rental_days_label?: string
  duration_type:     string | null
  pickup_method:     string | null
  return_method:     string | null
  pickup_time:       string | null
  return_time:       string | null
  /** 방문 지점명(Migration #480) — rental_reservations.pickup_point_id/return_point_id
      (Migration #479로 실제 저장 시작)를 pickup_points와 조인한 값. 지점이 없는 방식
      (배송 등)은 NULL — "수령방식"/"반납방식" 표시 시 "방식명 (지점명)" 형태로 조합 */
  pickup_point_name: string | null
  return_point_name: string | null
  user_id:           string
  customer_name:     string
  customer_email:    string
  customer_phone:    string
  membership_grade:  string
  credit_score:      number
  product_id:        string
  product_name:      string
  product_code:      string | null
  product_category:  string
  product_image_url: string | null
  order_id:          number | null
  order_key:         string | null
  order_amount:      number | null
  discount_amount:   number | null
  /** 쿠폰 할인액(Migration #471) — orders.coupon_discount_amount, create_reservation_order RPC가
      계산·저장. discount_amount(등급할인)와 별도 컬럼 — 결제정보 탭 "쿠폰 할인" 행 전용 */
  coupon_discount_amount: number | null
  /** 할인 전 원가(Migration #472) — orders.total_amount. "정산내역" 섹션 "기본 대여요금" 전용 */
  total_amount:      number | null
  /** 결제 시 차감된 포인트(Migration #472) — orders.selected_points. "정산내역" 섹션 "포인트 사용" 전용 */
  selected_points:   number | null
  tax_amount:        number | null
  delivery_fee:      number | null
  /** orders.delivery_fee(Migration #473) — 위 delivery_fee(payment_transactions 최근 거래 기준)와
      달리 final_amount 산식에 실제로 반영된 배송비. 결제 전(hold 등) 예약도 값이 채워짐 —
      "정산내역" 섹션 "배송비" 전용(위 delivery_fee와 혼용 금지, 합계 정합이 깨짐) */
  order_delivery_fee: number | null
  payment_status:    string | null
  contract_id:       string | null
  contract_status:   string | null
  contract_pdf_url:  string | null
  auto_signed_at:    string | null
  customer_signed_at: string | null
  signing_sent_at:   string | null
  signing_token:     string | null
  created_at:        string
  payment_confirmed_at: string | null
  total_count:       number
  // Migration 344: 두발히어로 배송 상태 (nullable — 이전 예약은 NULL)
  dhero_status:         string | null
  dhero_status_code:    number | null
  dhero_return_book_id: string | null
  dhero_synced_at:      string | null
  tracking_number:      string | null
  /** Migration 618 — 이 행(대표 예약) 자신의 실제 상태. 묶음 모드의 status는 "주문 상태"(형제 중 가장 덜 진행된 단계)다 */
  own_status:           string
  /** Migration 618 — 같은 주문에 묶인 예약(상품) 수. 1이면 단일 상품 주문 */
  order_item_count:     number
  /** Migration 618 — 활성 형제의 진행 단계가 서로 다른가(예: 일부만 반출) — "일부 진행" 표기용 */
  status_mixed:         boolean
}

// 예약현황과 대여현황은 /cms/rentals 한 화면으로 통합됐다(2026-10-22, Stephen 확정) — 이 주소로 들어오는 기존 링크(채팅 카드·알림·북마크)는
// 쿼리(status·contract_pending·search·date_from·date_to·page·selected)를 그대로 넘겨 통합 화면으로 보낸다.
// 이 경로의 폼 액션(approveReservation·updateStatus·changeReservation 등)은 패널이 절대 주소로 호출하므로 그대로 둔다.
export const load: PageServerLoad = async ({ url }) => {
  throw redirect(303, `/cms/rentals${url.search}`)
}

// ── 상태 전환 공용 로직 (2026-10-27, ④ 주문 단위 단일 처리 버튼) ─────────────────────────────────────────────
// 기존 updateStatus 본문을 함수로 옮겨 단건 처리(updateStatus)와 주문 단위 처리(updateOrderStatus)가 같은 규칙을 쓰게 한다.
// 단건 호출의 동작은 이전과 같다(옵션 없이 호출). 주문 단위 처리는 상품별 전환만 이 함수로 하고 고객 알림·두발히어로 호출은 주문당 1회로 묶는다.
function makeStatusAdmin() { return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) }
type StatusAdmin = ReturnType<typeof makeStatusAdmin>
interface StatusCtx { admin: StatusAdmin; session: { user: { id: string } }; cmsRole: string }
interface UpdateStatusOpts { skipNotify?: boolean; skipDhero?: boolean }

/** 상태 전환 시 자동 발송하는 고객 알림 대응표 (rental-lifecycle.md AUTO_NOTIFY) */
const AUTO_NOTIFY: Partial<Record<string, string>> = {
  shipped:          'shipment_notify',
  in_use:           'rental_confirm',
  return_requested: 'return_registration',
  cancelled:        'reservation_cancelled',
  damage_claimed:   'damage_claimed',
}

/**
 * shipped·return_requested·cancelled 전이 시 두발히어로 API 자동 호출(fail-soft — 상태 전이에 영향 없음).
 * reservationIds 가 여러 개면(주문 단위 처리) 접수·반품 접수는 주문당 1회만 호출하고, 받은 접수번호·반품번호를 모든 예약에 저장한다.
 * 1개면 이전 단건 동작과 같다. 연동 대상 판정은 isDheroIntegrationMethod(전용 스위치)다.
 */
async function triggerDheroForTransition(
  admin: StatusAdmin,
  reservationIds: number[],
  newStatus: string,
): Promise<{ dheroCancelFailed: boolean; dheroBookFailedMsg: string | null }> {
  let dheroCancelFailed = false
  let dheroBookFailedMsg: string | null = null
  if (reservationIds.length === 0) return { dheroCancelFailed, dheroBookFailedMsg }
  if (!(newStatus === 'shipped' || newStatus === 'return_requested' || newStatus === 'cancelled')) return { dheroCancelFailed, dheroBookFailedMsg }

  const reservationId = reservationIds[0]
  try {
    // 예약 정보 JOIN 조회 — user_profiles/user_shipping_addresses/products 포함(공유 모듈 getReservationForDhero)
    const res = await getReservationForDhero(admin, reservationId)

    if (res) {
      // 같은 주문의 나머지 상품 정보(상품명 합치기·반품 운송장 찾기) — 주문 단위 처리일 때만
      const others = reservationIds.length > 1
        ? (await Promise.all(reservationIds.slice(1).map((id) => getReservationForDhero(admin, id).catch(() => null)))).filter((r): r is NonNullable<typeof r> => r != null)
        : []

      if (newStatus === 'shipped') {
        const isDheroOn = await isDheroIntegrationMethod(admin, res.pickupMethod)
        // 이미 운송장이 있는 주문은 다시 접수하지 않는다 — 중복 배송 접수 방지(2026-10-27).
        //  · 두발히어로 접수번호(관리자가 '두발히어로 배송접수'를 먼저 눌렀음) → 정상이라 조용히 건너뜀
        //  · 다른 택배사 운송장(직접 입력) → 건너뛰되 관리자에게 알림(접수가 안 된 것을 모르고 지나가지 않도록)
        //  · 두발히어로 쪽에서 이미 취소된 접수(dhero_meta.canceledAt — 동기화·상태 조회가 기록)는 '접수됨'으로 보지 않는다 → 새 번호(`예약코드-N`)로 재접수
        const booked = liveDheroBookings([res, ...others])
        const alreadyBooked = booked.length > 0
        const foreignBooked = booked.find((u) => u.courierCode !== '두발히어로')
        if (isDheroOn && foreignBooked) {
          dheroBookFailedMsg = `이미 등록된 ${foreignBooked.courierCode ?? '다른 택배사'} 운송장이 있어 두발히어로 배송 접수를 건너뛰었습니다. 두발히어로로 접수하려면 운송장을 비운 뒤 '두발히어로 배송접수'를 눌러주세요.`
        }
        if (isDheroOn && !alreadyBooked) {
          try {
            // 주소·우편번호가 없으면 두발히어로가 접수를 거절하므로 호출 전에 사유를 명확히 알린다
            // (실패가 조용히 삼켜져 운송장이 안 생기던 결함 — 2026-10-12)
            if (!res.address || !res.postalCode) {
              dheroBookFailedMsg = !res.address
                ? '배송지 주소가 없어 두발히어로 배송 접수를 하지 못했습니다.'
                : '배송지 우편번호가 없어 두발히어로 배송 접수를 하지 못했습니다.'
              throw new Error(dheroBookFailedMsg)
            }
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
            for (const id of reservationIds) {
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
            // 운송장(접수번호) 저장 직후 고객에게 택배사·운송장 번호 안내(주문당 1회, fail-soft, 2026-10-27)
            await notifyTrackingRegistered(admin as never, reservationId)
            // placePageUrl이 있으면 고객 채팅으로 수령위치 등록 안내 전달(주문당 1회, fail-soft)
            // service-operations.md §11: find_or_create_general_chat_session 경유는 RPC 내부에서 처리
            // service-operations.md §15: push.ts CUSTOMER_LIFECYCLE_PUSH_COPY에 dhero_place_guide 등록 완료
            if (deliveryRes.placePageUrl) {
              try {
                await admin.rpc('send_rental_chat_notification', {
                  p_reservation_id: reservationId,
                  p_notify_type:    'dhero_place_guide',
                  p_action_url:     deliveryRes.placePageUrl,
                })
                await sendReservationLifecyclePush(admin, reservationId, 'dhero_place_guide')
              } catch (notifyErr) {
                console.error('[dhero/place_guide notify] fail-soft:', notifyErr instanceof Error ? notifyErr.message : notifyErr)
              }
            }
          } catch (e) {
            if (!dheroBookFailedMsg) {
              dheroBookFailedMsg = e instanceof DheroApiError
                ? `두발히어로 배송 접수에 실패했습니다: ${e.message}`
                : '두발히어로 배송 접수에 실패했습니다.'
            }
            console.error('[dhero/shipped] fail-soft:', e instanceof Error ? e.message : e)
          }
        }
      } else if (newStatus === 'return_requested') {
        const isDheroOn = await isDheroIntegrationMethod(admin, res.returnMethod)
        const trackingNumber = res.trackingNumber ?? others.find((o) => o.trackingNumber)?.trackingNumber ?? null
        if (isDheroOn && trackingNumber) {
          try {
            const returnRes = await registerReturn(trackingNumber)
            // 안내서: 2xx 여도 success=false 일 수 있다(reason 에 사유) — 반품번호를 저장하지 않고 관리자에게 알린다(알려진 이슈 #9)
            if (returnRes.success === false) {
              const reason = typeof returnRes.reason === 'string' && returnRes.reason ? `: ${returnRes.reason}` : ''
              dheroBookFailedMsg = `두발히어로가 반품 접수를 받아들이지 않았습니다${reason}`
              console.error(`[dhero/return_requested] 반품 접수 거절(success=false)${reason}`)
            } else {
              for (const id of reservationIds) {
                await admin.rpc('update_reservation_dhero_shipment', {
                  p_reservation_id:  id,
                  p_tracking_number: trackingNumber,
                  p_courier_code:    '두발히어로',
                  p_status:          DHERO_STATUS_LABEL[0] ?? '반품접수',
                  p_status_code:     0,
                  p_dong_group:      returnRes.dongGroup ?? null,
                  p_meta:            returnRes as Record<string, unknown>,
                  p_return_book_id:  returnRes.bookId,
                })
              }
            }
          } catch (e) {
            dheroBookFailedMsg = e instanceof DheroApiError
              ? `두발히어로 반품 접수에 실패했습니다: ${e.message}`
              : '두발히어로 반품 접수에 실패했습니다.'
            console.error('[dhero/return_requested] fail-soft:', e instanceof Error ? e.message : e)
          }
        }
      } else if (newStatus === 'cancelled') {
        const trackingNumber = res.trackingNumber
        if (trackingNumber && isDheroBooking(res.courierCode)) {  // P3-2: 두발히어로 접수번호만 취소 호출
          try {
            await cancelDelivery(trackingNumber)
          } catch (e) {
            if (e instanceof DheroApiError && e.statusCode === 412) {
              if (isAlreadyCanceledError(e)) {
                // (a) 두발히어로 쪽 이미 취소된 배송 → 성공에 준함, 경고 플래그 없음 (dhero-delivery-api.md §5)
                // tracking_number 미초기화 — 기존 취소 성공 경로와 동일하게 유지(예약이 cancelled 상태로 전환되므로 운송장 잔존 무해)
              } else {
                // (b) 취소 불가 상태(배송 출발·완료 등) 또는 메시지 불명확 → fail-safe: 경고 플래그
                dheroCancelFailed = true
              }
            } else {
              console.error('[dhero/cancelled] fail-soft:', e instanceof Error ? e.message : e)
            }
          }
        }
      }
    }
  } catch (e) {
    // 예약 조회 자체 실패도 fail-soft — 상태전이는 이미 성공
    console.error('[dhero] reservation lookup fail-soft:', e instanceof Error ? e.message : e)
  }
  return { dheroCancelFailed, dheroBookFailedMsg }
}

async function updateStatusCore(ctx: StatusCtx, reservationId: number, newStatus: string, opts: UpdateStatusOpts = {}) {
  const { admin, session, cmsRole } = ctx
  // 계약완료(confirmed)로의 직접 전환은 이 액션으로 하지 않는다(Stephen 2026-10-15) — 서명·결제 없이 신청대기를 확정하는 경로를 서버에서 막는다.
  // 계약완료는 고객의 전자계약 서명 + 결제가 모두 끝났을 때만 try_confirm_reservation이 자동 전환한다(service-operations.md §9).
  // (confirmed 이후 단계 전환 shipped·in_use 등은 영향 없음 — 이 값으로 들어오는 정상 화면 호출은 없다)
  // 완료(completed)도 이 액션으로 직접 전환하지 않는다(2026-10-17) — 반납 검수 승인(검수 탭 [반납 검수 승인])을 거쳐야 하며 DB 트리거도 같은 규칙을 집행한다.
  if (newStatus === 'completed') {
    return fail(400, { message: '완료 처리는 검수 탭의 [반납 검수 승인]으로 진행해 주세요.' })
  }
  if (newStatus === 'confirmed') {
    return fail(400, { message: '계약완료는 고객의 전자계약 서명과 결제가 모두 끝나야 자동으로 전환돼요. 직접 변경할 수 없습니다.' })
  }

  // cancelled 분기 — Defect 1·2 수정 (2026-09-14)
  // Defect 1: 이전 코드는 cancel_reservation_payment(순수 SQL RPC)만 호출해
  //   Toss 실결제 취소가 누락됨. 결제가 있으면 반드시 Toss API 먼저 호출 후 RPC.
  //   결제 없는 경우(PAYMENT_NOT_FOUND)는 Toss 건너뛰고 RPC 직행.
  // Defect 2: hasSettingsAccess 게이트 누락 — partner도 전액 환불+계약 취소 가능한 상태였음.
  //   manager/superadmin: Toss + cancel_reservation_payment (환불+형제+계약 일괄 취소)
  //   partner:            update_reservation_status만 (상태 전환 전용, 환불·계약 취소 없음)
  let cancelledSiblingIds: number[] = []
  if (newStatus === 'cancelled') {
    if (hasSettingsAccess(cmsRole)) {
      // ── manager/superadmin 경로: Toss 환불 → cancel_reservation_payment ──

      // rental.change_cancel 세부 권한 체크 — 역할 게이트(manager+) 통과 후 계정 오버레이 검증
      const { data: permDataUS } = await admin
        .from('cms_menu_permissions')
        .select('menu_key, allowed')
        .eq('user_id', session.user.id)
      const menuOverridesUS = (permDataUS ?? []) as CmsMenuPermissionOverride[]
      if (!hasMenuAccess(cmsRole, menuOverridesUS, 'rental.change_cancel')) {
        return fail(403, { message: '이 계정은 예약변경·취소 권한이 없습니다.' })
      }

      // 1. payment_key 조회 (changeReservation 액션과 동일한 2단계 패턴)
      let paymentKey: string | null = null
      const { data: ptDirect } = await admin
        .from('payment_transactions')
        .select('payment_key, status')
        .eq('reservation_id', reservationId)
        .eq('status', 'done')
        .maybeSingle()
      paymentKey = (ptDirect as { payment_key?: string | null } | null)?.payment_key ?? null

      if (!paymentKey) {
        const { data: orderItem } = await admin
          .from('order_items')
          .select('order_id')
          .eq('reservation_id', reservationId)
          .maybeSingle()
        const orderId = (orderItem as { order_id?: number | null } | null)?.order_id
        if (orderId != null) {
          const { data: siblingItems } = await admin
            .from('order_items')
            .select('reservation_id')
            .eq('order_id', orderId)
          const siblingIds = ((siblingItems ?? []) as { reservation_id: number | null }[])
            .map((r) => r.reservation_id)
            .filter((v): v is number => v != null)
          if (siblingIds.length > 0) {
            const { data: sibPt } = await admin
              .from('payment_transactions')
              .select('payment_key, status')
              .in('reservation_id', siblingIds)
              .eq('status', 'done')
              .maybeSingle()
            paymentKey = (sibPt as { payment_key?: string | null } | null)?.payment_key ?? null
          }
        }
      }

      // 2. 결제 있는 경우: Toss 취소 먼저 → 성공 후 RPC
      //    결제 없는 경우: Toss 건너뛰고 RPC 직행 (cancel_reservation_payment가 PAYMENT_NOT_FOUND 처리)
      let pgCancelledAt: string | undefined
      if (paymentKey) {
        const tossResult = await tossPaymentCancel(paymentKey, '관리자 예약 취소')
        if (!tossResult.ok) return fail(400, { message: tossResult.error ?? '결제 취소에 실패했습니다.' })
        pgCancelledAt = tossResult.pgCancelledAt

        // pg_cancelled_at 기록 — fail-soft (payment_transactions.cancelled_at은 RPC가 기록,
        // pg_cancelled_at(PG 실제 취소 시각)만 보강)
        if (pgCancelledAt) {
          try {
            await admin
              .from('payment_transactions')
              .update({ pg_cancelled_at: pgCancelledAt })
              .eq('payment_key', paymentKey)
          } catch { /* fail-soft */ }
        }
      }

      // 3. cancel_reservation_payment RPC (rpcRetryWithFailSoftLog: 3회 재시도 + fail-soft)
      type CrResult = { success: boolean; error?: string; cancelled_reservation_ids?: number[] }
      const { rpcResult: cr, failed: cancelFailed, failureReason: cancelFailReason } = await rpcRetryWithFailSoftLog<CrResult>({
        admin,
        rpcName: 'cancel_reservation_payment',
        rpcParams: {
          p_reservation_id: reservationId,
          p_admin_id:       session.user.id,
          p_cancel_reason:  '관리자 예약 취소',
        },
        isSuccess: (r) => r !== null && (r.success !== false || r.error === 'PAYMENT_NOT_FOUND'),
        paymentKey,
        reservationId,
        contextLabel: '관리자 예약취소 DB 반영',
      })
      if (cancelFailed) {
        return fail(500, { message: `DB 반영 실패: ${cancelFailReason}. Toss 취소는 이미 완료됐습니다.` })
      }
      if (!cr) return fail(500, { message: '예약 취소 처리 실패' })

      // 4. 취소된 형제 예약 ID 수집 (배치 알림용)
      //    EC-1(결제 있음): cancelled_reservation_ids 반환
      //    EC-2(PAYMENT_NOT_FOUND): 반환 없음 → order_items 조회로 별도 수집
      if (cr.success && cr.cancelled_reservation_ids?.length) {
        cancelledSiblingIds = cr.cancelled_reservation_ids
      } else {
        // PAYMENT_NOT_FOUND 또는 단건 — order_items에서 형제 수집
        try {
          const { data: oiForBatch } = await admin
            .from('order_items')
            .select('order_id')
            .eq('reservation_id', reservationId)
            .maybeSingle()
          const batchOrderId = (oiForBatch as { order_id?: number | null } | null)?.order_id
          if (batchOrderId != null) {
            const { data: batchSibs } = await admin
              .from('order_items')
              .select('reservation_id')
              .eq('order_id', batchOrderId)
            cancelledSiblingIds = ((batchSibs ?? []) as { reservation_id: number | null }[])
              .map((r) => r.reservation_id)
              .filter((v): v is number => v != null)
          }
        } catch { /* fail-soft */ }
        if (!cancelledSiblingIds.length) cancelledSiblingIds = [reservationId]
      }

    } else {
      // ── partner 경로: 상태 전환만 (환불·계약 취소 없음) ──
      // order_items에서 형제 예약 전체를 수집해 각각 update_reservation_status 호출
      let siblingIds: number[] = [reservationId]
      try {
        const { data: oiRow } = await admin
          .from('order_items')
          .select('order_id')
          .eq('reservation_id', reservationId)
          .maybeSingle()
        const oiOrderId = (oiRow as { order_id?: number | null } | null)?.order_id
        if (oiOrderId != null) {
          const { data: siblings } = await admin
            .from('order_items')
            .select('reservation_id')
            .eq('order_id', oiOrderId)
          const mapped = ((siblings ?? []) as { reservation_id: number | null }[])
            .map((r) => r.reservation_id)
            .filter((v): v is number => v != null)
          if (mapped.length > 0) siblingIds = mapped
        }
      } catch { /* fail-soft — 최소한 self는 처리 */ }

      for (const rid of siblingIds) {
        const { data: statusResult, error: statusError } = await admin.rpc('update_reservation_status', {
          p_reservation_id: rid,
          p_new_status:     'cancelled',
        })
        if (statusError) {
          // 요청 예약만 hard fail, 이미 terminal인 형제는 graceful skip
          if (rid === reservationId) return fail(500, { message: statusError.message })
          continue
        }
        const sr = statusResult as { ok: boolean; error?: string } | null
        if (!sr?.ok && rid === reservationId) {
          return fail(400, { message: sr?.error ?? '예약 취소 처리 실패' })
        }
      }
      cancelledSiblingIds = siblingIds
    }
  } else {
    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     newStatus,
    })
    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '처리 실패' })
  }

  // 대여 액션 로그 기록 — 실패해도 메인 처리에 영향 없음 (fail-soft)
  // note='manual'로 수동 CMS 조작임을 표시 (QR 경로 note='qr_scan'과 구분 — EC-4)
  try {
    await admin.rpc('log_rental_action', {
      p_reservation_id: reservationId,
      p_action_type:    newStatus,
      p_admin_id:       session.user.id,
      p_note:           'manual',
    })
  } catch { /* 로그 실패는 무시 */ }

  // 정시반납 포인트 자동적립 — returned 전이 시에만, fail-soft(공용 헬퍼가 내부 처리)
  // QR 반납 경로(rentalQrTransition.ts)도 동일하게 배선됨(log_rental_action과 동일 이중 배선)
  // ⛔ 대여완료 포인트·"대여 완료" 알림은 더 이상 returned 시점에 나가지 않는다(2026-10-17, Migration #724) —
  //    관리자의 반납 검수 승인(lib/server/inspection.ts approveInspection)에서만 지급·발송한다.
  //    정시반납 적립은 호출 시점(오늘)을 반납 시점으로 보는 로직이라 returned 시점에 그대로 둔다.
  if (newStatus === 'returned') {
    try {
      await awardOnTimeReturnPoints(admin, reservationId)
    } catch { /* 포인트 적립 실패는 무시 */ }
  }

  // 상태 전환별 채팅 알림 자동 발송(대응표 AUTO_NOTIFY 는 모듈 상수) — 주문 단위 처리(opts.skipNotify)에서는 호출 측이 주문당 1회만 보낸다
  // fail-soft(2026-09-08 수정) — 이 블록이 예외를 던지면 상태전이(이미 위에서 성공)는
  // DB에 반영됐음에도 액션 응답 직렬화가 깨져 클라이언트 use:enhance 콜백이 끝내 호출되지
  // 않고 "거부"/"예약 취소" 등 버튼이 무한로딩에 빠지는 결함이 실사용 중 발견됨(reservation
  // id 139) — log_rental_action(위 173행)과 동일한 fail-soft 원칙을 적용해 해소.
  const notifyType = opts.skipNotify ? undefined : AUTO_NOTIFY[newStatus]
  if (notifyType) {
    // cancelled + 형제 예약 2개 이상: send_rental_chat_notification_batch로 일괄 발송
    // 그 외: 단건 send_rental_chat_notification
    try {
      if (newStatus === 'cancelled' && cancelledSiblingIds.length > 1) {
        await admin.rpc('send_rental_chat_notification_batch', {
          p_reservation_ids: cancelledSiblingIds,
          p_notify_type:     notifyType,
        })
      } else {
        await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: reservationId,
          p_notify_type: notifyType,
        })
      }
    } catch { /* 채팅 알림 발송 실패는 무시 */ }
    // 상태 전환 푸시 알림 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
    try {
      await sendReservationLifecyclePush(admin, reservationId, notifyType)
    } catch { /* 푸시 알림 발송 실패는 무시 */ }
  }

  // ── 두발히어로 fail-soft 트리거 — 공용 함수(triggerDheroForTransition) 호출. 주문 단위 처리(opts.skipDhero)에서는 호출 측이 주문당 1회만 호출한다 ──
  let dheroCancelFailed = false
  let dheroBookFailedMsg: string | null = null
  if (!opts.skipDhero) {
    const dh = await triggerDheroForTransition(admin, [reservationId], newStatus)
    dheroCancelFailed = dh.dheroCancelFailed
    dheroBookFailedMsg = dh.dheroBookFailedMsg
  }
  // ── dhero 트리거 끝 ────────────────────────────────────────────────────

  return {
    ok: true,
    ...(dheroCancelFailed ? { dhero_cancel_failed: true } : {}),
    ...(dheroBookFailedMsg ? { dhero_book_failed: dheroBookFailedMsg } : {}),
  }
}

export const actions: Actions = {
  approveReservation: async ({ request, locals, fetch }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))

    // 주문 1건 = 목록 1행(Migration 618) — "승인하기"는 같은 주문의 신청대기(hold) 상품 전체에 적용한다
    // (고객이 한 번에 신청한 한 건이므로 일부만 승인된 채 남지 않게). 요청한 예약이 이미 hold가 아니어도
    // (대표 행이 먼저 승인된 혼합 주문 등) 주문 안의 다른 hold 상품을 승인할 수 있어야 한다.
    let holdIds: number[] = []
    try {
      const { data: ownItem } = await admin
        .from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
      const orderId = (ownItem as { order_id: number | null } | null)?.order_id
      let memberIds: number[] = [reservationId]
      if (orderId != null) {
        const { data: sibItems } = await admin
          .from('order_items').select('reservation_id').eq('order_id', orderId)
        const mapped = ((sibItems ?? []) as Array<{ reservation_id: number | null }>)
          .map((r) => r.reservation_id)
          .filter((v): v is number => v != null)
        if (mapped.length > 0) memberIds = mapped
      }
      const { data: holdRows } = await admin
        .from('rental_reservations').select('id').in('id', memberIds).eq('status', 'hold')
      holdIds = ((holdRows ?? []) as Array<{ id: number }>).map((r) => r.id)
    } catch (err) {
      console.error('[cms/reservation] approveReservation 주문 내 hold 조회 실패:', reservationId, err)
    }

    // 주(主) 승인 대상 — 요청한 예약이 hold면 그것, 아니면 주문 내 첫 hold(없으면 요청 예약 그대로 시도해 기존 에러를 돌려준다)
    const primaryId = holdIds.includes(reservationId) ? reservationId : (holdIds[0] ?? reservationId)

    // 본인증명정보 미등록 고객이면 등록요청(기존 identity_request 카드 + 푸시 + SMS, CMS 안내문장 반영)을 함께 보낸다(2026-10-15, Stephen 확정).
    // 서류 승인대기·승인완료·탈퇴 계정, 24시간 내 같은 카드가 있는 경우는 헬퍼가 건너뛴다. 실패해도 승인 결과에는 영향 없다(fail-soft).
    // 반환값 = 요청 카드가 실제로 발송됐는지(24시간 내 중복·탈퇴 계정·오류면 false — 화면 안내가 실제 발송과 어긋나지 않게, QA MINOR 3)
    const sendIdentityRequest = async (): Promise<boolean> => {
      try {
        const { data: ownerRow } = await admin
          .from('rental_reservations').select('user_id').eq('id', primaryId).maybeSingle()
        const ownerId = (ownerRow as { user_id: string | null } | null)?.user_id
        if (ownerId) return (await requestIdentityDocRegistration(admin, ownerId, { reservationId: primaryId })).requested
      } catch { /* 등록요청 발송 실패는 무시 */ }
      return false
    }
    // 승인 요청 표식 비우기(계약서 발송·확정으로 더는 대기하지 않는 예약) — 옛 표식이 남아 다음 서류 승인 때 뜻밖에 자동 발송되는 일을 막는다(QA MINOR 1, fail-soft)
    const clearApproveRequested = async (): Promise<void> => {
      try {
        await admin.from('rental_reservations').update({ approve_requested_at: null }).in('id', holdIds).not('approve_requested_at', 'is', null)
      } catch { /* 무시 */ }
    }

    // '예약승인'은 예약을 확정하지 않는다(Stephen 2026-10-15) — 계약완료(confirmed)는 고객의 전자계약 서명 + 결제가 모두 끝났을 때만 자동으로 된다(§9, try_confirm_reservation).
    // 이 액션은 서류 상태에 따라 '고객에게 무엇을 요청할지'만 결정한다:
    //   ① 본인증명정보 미등록·필수 서류 미비 → 등록요청(채팅 카드·푸시·SMS) 발송 + 승인 요청 표식, 화면 버튼은 '승인대기'
    //   ② 서류는 등록했으나 승인 대기 → 안내만(서류 승인 시 표식이 있는 예약에 계약서 자동 발행·발송)
    //   ③ 서류 승인 완료 → 자동발행 표준양식(양식 화면의 토글 ON)으로 계약서를 만들어 고객에게 서명 요청(채팅 카드·푸시·SMS)까지 자동 발송, 예약은 신청대기 유지
    //   표준양식이 없거나 자동발행을 못 하면 확정하지 않는다 — 승인완료(approved_at)로 기록하고 관리자가 계약서 탭에서 수동 발행·발송한다.
    if (holdIds.length === 0) return fail(400, { message: '신청대기 상태의 예약이 아니어서 예약승인을 할 수 없어요.' })

    let gate: DocGateStatus = 'none'
    try {
      const { data: ownerRow } = await admin
        .from('rental_reservations').select('user_id').eq('id', primaryId).maybeSingle()
      const ownerId = (ownerRow as { user_id: string | null } | null)?.user_id
      if (ownerId) {
        const { data: prof } = await admin
          .from('user_profiles')
          .select(
            'identity_doc_url, identity_type, identity_verified_at, identity_approved_at, ' +
              'foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at',
          )
          .eq('id', ownerId)
          .maybeSingle()
        gate = getDocGateStatus(prof as DocGateRow | null)
      }
    } catch (err) {
      console.error('[cms/reservation] approveReservation 서류 상태 조회 실패:', reservationId, err)
    }

    // 서류가 승인될 때까지 기다리는 예약 표식 — 관리자가 고객 서류를 승인하면 이 표식이 있는 예약에만 계약서가 자동 발행·발송된다(Migration #718, fail-soft)
    const markApproveRequested = async (): Promise<void> => {
      try {
        await admin.from('rental_reservations').update({ approve_requested_at: new Date().toISOString() }).in('id', holdIds)
      } catch { /* 표식 기록 실패는 무시 — 서류 승인 후 다시 예약승인을 누르면 된다 */ }
    }
    if (gate === 'pending') {
      await markApproveRequested()
      return { ok: true, identityPending: true }
    }
    if (gate !== 'approved') {
      await markApproveRequested()
      const requestSent = await sendIdentityRequest()
      return { ok: true, identityRequested: true, identityRequestSent: requestSent }
    }

    // 서류 승인 완료 고객 — '예약승인' 완료를 기록한다(approved_at, Migration #719). 이 값이 있으면 화면 버튼은 '승인완료', 예약은 '계약대기' 칩으로 옮겨지고,
    // 예약의 계약서 탭에서 전자계약을 발행·발송할 수 있게 된다(승인 전에는 발행 불가). 자동발행이 되든 안 되든(토글 OFF·실패 포함) 승인 자체는 완료다.
    try {
      await admin.from('rental_reservations').update({ approved_at: new Date().toISOString() }).in('id', holdIds).is('approved_at', null)
    } catch { /* 기록 실패는 무시 — 다시 예약승인을 누르면 된다 */ }

    if (!(await hasAutoIssueTemplate(admin))) {
      // 자동발행 표준양식이 꺼져 있으면 관리자가 계약서 탭에서 수동으로 발행·발송한다
      await clearApproveRequested()
      return { ok: true, approvedManual: true }
    }

    let autoIssue: AutoIssueResult
    try {
      autoIssue = await autoIssueContractOnApproval({ admin, fetch }, primaryId)
    } catch (err) {
      console.error('[cms/reservation] approveReservation 계약서 자동발행 예외:', reservationId, err)
      autoIssue = { status: 'skipped', reason: 'issue_failed', message: '계약서 자동발행 중 오류가 발생해 자동발행하지 못했어요.' }
    }
    if (autoIssue.status === 'sent') {
      await clearApproveRequested()
      return { ok: true, contractIssued: true, contractTitle: autoIssue.templateTitle }
    }
    // 이미 계약서가 있는 주문은 다시 눌러도 새로 만들지 않는다
    if (autoIssue.status === 'skipped' && autoIssue.reason === 'contract_exists') {
      await clearApproveRequested()
      return { ok: true, contractExists: true, contractSkipped: autoIssue.message }
    }
    // 그 밖의 건너뜀(양식 문제·발송 실패·일시 오류 등)도 확정하지 않는다 — 승인은 완료(approved_at)됐으므로 계약서 탭에서 직접 발행하도록 사유만 안내
    await clearApproveRequested()
    return { ok: true, contractNotIssued: true, contractSkipped: autoIssue.status === 'skipped' ? autoIssue.message : '계약서를 자동발행하지 못했어요.' }
  },

  // 플랜 §3: 예약변경 — Toss 결제 취소 → revert_reservation_order_to_hold
  // manager+ 게이트, fail-soft 알림 포함
  changeReservation: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // rental.change_cancel 세부 권한 체크 — hasSettingsAccess(역할 게이트) 통과 후 추가 검증
    // 계정 오버레이(cms_menu_permissions)로 manager 계정이 이 기능을 개별 차단할 수 있음
    // (security-auth.md "메뉴별 세부 접근권한" 참고)
    const { data: permDataCC } = await admin
      .from('cms_menu_permissions')
      .select('menu_key, allowed')
      .eq('user_id', session.user.id)
    const menuOverridesCC = (permDataCC ?? []) as CmsMenuPermissionOverride[]
    if (!hasMenuAccess(cmsRole, menuOverridesCC, 'rental.change_cancel')) {
      return fail(403, { message: '이 계정은 예약변경·취소 권한이 없습니다.' })
    }

    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    if (!reservationId) return fail(400, { message: '예약 ID가 없습니다.' })

    // 1. payment_key 조회 — 형제 예약인 경우 order_items 경유
    let paymentKey: string | null = null
    const { data: ptDirect } = await admin
      .from('payment_transactions')
      .select('payment_key, status')
      .eq('reservation_id', reservationId)
      .eq('status', 'done')
      .maybeSingle()
    paymentKey = (ptDirect as { payment_key?: string | null } | null)?.payment_key ?? null

    if (!paymentKey) {
      const { data: orderItem } = await admin
        .from('order_items')
        .select('order_id')
        .eq('reservation_id', reservationId)
        .maybeSingle()
      const orderId = (orderItem as { order_id?: number | null } | null)?.order_id
      if (orderId != null) {
        const { data: siblingItems } = await admin
          .from('order_items')
          .select('reservation_id')
          .eq('order_id', orderId)
        const siblingIds = ((siblingItems ?? []) as { reservation_id: number | null }[])
          .map((r) => r.reservation_id)
          .filter((v): v is number => v != null)
        if (siblingIds.length > 0) {
          const { data: sibPt } = await admin
            .from('payment_transactions')
            .select('payment_key, status')
            .in('reservation_id', siblingIds)
            .eq('status', 'done')
            .maybeSingle()
          paymentKey = (sibPt as { payment_key?: string | null } | null)?.payment_key ?? null
        }
      }
    }

    if (!paymentKey) return fail(404, { message: '결제 정보를 찾을 수 없습니다.' })

    // 2. Toss 결제 취소
    const tossResult = await tossPaymentCancel(paymentKey, '예약변경 - 결제 재진행')
    if (!tossResult.ok) return fail(400, { message: tossResult.error ?? '결제 취소에 실패했습니다.' })

    // 3. DB: 예약 hold로 되돌리기 (rpcRetryWithFailSoftLog: 3회 재시도 + fail-soft)
    type RevertResult = { ok: boolean; error?: string }
    const { rpcResult: rv, failed: revertFailed, failureReason: revertFailReason } = await rpcRetryWithFailSoftLog<RevertResult>({
      admin,
      rpcName: 'revert_reservation_order_to_hold',
      rpcParams: { p_reservation_id: reservationId, p_admin_id: session.user.id },
      isSuccess: (r) => r !== null && r.ok === true,
      paymentKey,
      reservationId,
      contextLabel: '예약변경 DB 반영',
    })
    if (revertFailed) {
      return fail(500, { message: `DB 반영 실패: ${revertFailReason}. Toss 취소는 이미 완료됐습니다.` })
    }
    if (!rv?.ok) return fail(400, { message: rv?.error ?? '예약 변경 처리 실패' })

    // 4. pg_cancelled_at 기록 — fail-soft
    if (tossResult.pgCancelledAt) {
      try {
        await admin
          .from('payment_transactions')
          .update({ pg_cancelled_at: tossResult.pgCancelledAt })
          .eq('payment_key', paymentKey)
      } catch { /* fail-soft */ }
    }

    // 5. 같은 주문의 모든 예약 ID 수집 (알림용) — revert RPC는 reverted_reservation_ids를 반환하지 않음
    let allReservationIds: number[] = [reservationId]
    try {
      const { data: orderItemForNotify } = await admin
        .from('order_items')
        .select('order_id')
        .eq('reservation_id', reservationId)
        .maybeSingle()
      const orderIdForNotify = (orderItemForNotify as { order_id?: number | null } | null)?.order_id
      if (orderIdForNotify != null) {
        const { data: sibItems } = await admin
          .from('order_items')
          .select('reservation_id')
          .eq('order_id', orderIdForNotify)
        const sibIds = ((sibItems ?? []) as { reservation_id: number | null }[])
          .map((r) => r.reservation_id)
          .filter((v): v is number => v != null)
        if (sibIds.length > 0) allReservationIds = sibIds
      }
    } catch { /* fail-soft */ }

    // 6. 채팅 알림 발송 — fail-soft
    try {
      await admin.rpc('send_rental_chat_notification_batch', {
        p_reservation_ids: allReservationIds,
        p_notify_type:     'payment_cancelled_reissue',
      })
    } catch { /* fail-soft */ }

    // 7. 푸시 알림 발송 — fail-soft (각 예약별 독립)
    for (const rid of allReservationIds) {
      try {
        await sendReservationLifecyclePush(admin, rid, 'payment_cancelled_reissue')
      } catch { /* fail-soft */ }
    }

    return { ok: true }
  },

  updateStatus: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin     = makeStatusAdmin()
    const data      = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const newStatus     = data.get('status') as string

    return updateStatusCore({ admin, session, cmsRole }, reservationId, newStatus)
  },

  // ④ 주문 단위 단일 처리 버튼(2026-10-27, Stephen 확정 "기본값대로 진행") — 같은 주문의 상품들을 패널 하단 버튼 하나로 다음 단계로 처리한다.
  //  · 대상 = 같은 주문 중 "가장 덜 진행된 단계"의 상품(planOrderTransition) — 더 진행된 상품은 건드리지 않고 건너뜀으로 알린다
  //  · 상품별 전환은 updateStatusCore(단건과 같은 규칙) — 일부 실패해도 성공한 상품은 유지하고 실패한 상품을 알린다(롤백 없음)
  //  · 고객 알림(채팅·푸시)은 주문당 1회(대표 예약 기준), 두발히어로 접수·반품 접수는 주문당 1회(상품명을 합쳐 한 건, 접수번호는 상품 전부에 저장)
  //  · 허용 목표 단계: shipped·in_use·return_requested·returned — 완료(검수 승인)·취소·계약완료는 각자의 경로로만 간다
  updateOrderStatus: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = makeStatusAdmin()
    const data = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const newStatus = String(data.get('status') ?? '')
    if (!Number.isInteger(reservationId) || reservationId <= 0) return fail(400, { message: '예약 정보가 올바르지 않습니다.' })
    if (!(ORDER_LIFECYCLE_TARGETS as readonly string[]).includes(newStatus)) {
      return fail(400, { message: '이 단계는 주문 일괄 처리로 변경할 수 없습니다. 완료·취소·계약완료는 각자의 처리 화면에서 진행해 주세요.' })
    }

    // 같은 주문의 예약(상품) 목록 — 주문에 묶이지 않은 예약은 자기 자신만
    const ids = await listOrderReservationIds(admin, reservationId)

    const { data: unitRows, error: unitErr } = await admin
      .from('rental_reservations')
      .select('id, status, pickup_method, return_method')
      .in('id', ids)
    if (unitErr || !unitRows || unitRows.length === 0) return fail(404, { message: '예약을 찾을 수 없습니다.' })

    const plan = planOrderTransition(unitRows as OrderUnit[], newStatus)
    if (plan.targetIds.length === 0) {
      return fail(400, { message: '처리할 수 있는 상품이 없습니다. 화면을 새로고침해 현재 단계를 확인해 주세요.' })
    }

    const ctx: StatusCtx = { admin, session, cmsRole }
    const processed: number[] = []
    const failed: { id: number; message: string }[] = []
    for (const id of plan.targetIds) {
      const r = await updateStatusCore(ctx, id, newStatus, { skipNotify: true, skipDhero: true })
      const ok = r != null && typeof r === 'object' && 'ok' in r && (r as { ok?: boolean }).ok === true
      if (ok) processed.push(id)
      else failed.push({ id, message: ((r as { data?: { message?: string } } | null)?.data?.message) ?? '처리 실패' })
    }
    if (processed.length === 0) {
      return fail(500, { message: failed[0]?.message ?? '처리 실패', failed })
    }

    // 고객 알림 — 주문당 1회(대표 예약 기준, 채팅과 푸시는 독립이라 각각 fail-soft)
    const rep = processed.includes(reservationId) ? reservationId : processed[0]
    const notifyType = AUTO_NOTIFY[newStatus]
    if (notifyType) {
      try {
        await admin.rpc('send_rental_chat_notification', { p_reservation_id: rep, p_notify_type: notifyType })
      } catch { /* 채팅 알림 발송 실패는 무시 */ }
      try {
        await sendReservationLifecyclePush(admin, rep, notifyType)
      } catch { /* 푸시 알림 발송 실패는 무시 */ }
    }

    // 두발히어로 — 주문당 1회(성공한 상품 기준, fail-soft)
    const dh = await triggerDheroForTransition(admin, processed, newStatus)

    return {
      ok: true,
      processed,
      ...(failed.length > 0 ? { failed } : {}),
      ...(plan.skippedIds.length > 0 ? { skipped: plan.skippedIds } : {}),
      ...(dh.dheroBookFailedMsg ? { dhero_book_failed: dh.dheroBookFailedMsg } : {}),
    }
  },

  clearIssuedContract: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data       = await request.formData()
    const contractId = data.get('id') as string
    if (!contractId) return fail(400, { error: '계약서 ID가 없습니다.' })

    const result = await clearIssuedContractContent(contractId, admin)
    if (!result.ok) return fail(result.httpStatus, { error: result.error })
    return { ok: true }
  },

  // Stage 5 (EC-6): 발송된 미서명 계약서 폐기 — 서명 링크 즉시 만료 + 콘텐츠 초기화 (GATE B Q7)
  // manager 이상 전용 (send-chat 엔드포인트와 동일 권한 기준 — security-auth.md 접근 매트릭스 참조)
  discardSentContract: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data       = await request.formData()
    const contractId = data.get('id') as string
    if (!contractId) return fail(400, { error: '계약서 ID가 없습니다.' })

    const result = await discardSentContract(contractId, admin)
    if (!result.ok) return fail(result.httpStatus, { error: result.error })
    return { ok: true }
  },

  // 전자계약 발행 취소 — 고객 서명 완료건 포함 (2026-09-07 Stephen 확정)
  // manager 이상 전용 — discardSentContract와 동일 권한 기준(security-auth.md 접근 매트릭스 참조)
  cancelIssuedContract: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data       = await request.formData()
    const contractId = data.get('id') as string
    if (!contractId) return fail(400, { error: '계약서 ID가 없습니다.' })

    const result = await cancelIssuedContract(contractId, admin)
    if (!result.ok) return fail(result.httpStatus, { error: result.error })

    await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId,
      eventType: 'cancelled',
      actorType: 'admin',
      actorId: session.user.id,
      ipAddress: null,
    })

    return { ok: true }
  },
}
