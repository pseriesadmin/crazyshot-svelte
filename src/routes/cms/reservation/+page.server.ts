import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import { clearIssuedContractContent, discardSentContract, cancelIssuedContract } from '$lib/server/clearIssuedContractHelper'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { createDelivery, cancelDelivery, registerReturn, DheroApiError, DHERO_STATUS_LABEL } from '$lib/server/dhero'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'
import { isBulkDeliveryMethod } from '$lib/server/isBulkDeliveryMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { awardRentalCompletePoints } from '$lib/server/awardRentalCompletePoints'
import { attachRentalDaysLabel } from '$lib/server/rentalDaysLabel'
import { tossPaymentCancel } from '$lib/server/tossPaymentCancel'
import { rpcRetryWithFailSoftLog } from '$lib/server/rpcRetryWithFailSoftLog'

export interface RentalListRow {
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
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole, session } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 화면 최초진입(URL에 ?status= 자체가 없음) 기본값 = '신청대기'(hold) — 요구사항 1(2026-08-20).
  // '전체' 칩 클릭 시에는 +page.svelte가 status=''를 명시적으로 params에 채워 보내므로
  // url.searchParams.has('status')가 true가 되어 이 기본값으로 되돌아가지 않는다.
  const status   = url.searchParams.has('status') ? (url.searchParams.get('status') ?? '') : 'hold'
  const search   = url.searchParams.get('search')    ?? ''
  const dateFrom = url.searchParams.get('date_from') ?? ''
  const dateTo   = url.searchParams.get('date_to')   ?? ''
  const page     = parseInt(url.searchParams.get('page') ?? '1', 10)
  const selectedParam = url.searchParams.get('selected')
  const selectedId    = selectedParam ? parseInt(selectedParam, 10) : null
  // '계약대기' 필터칩(2026-08-20 신설 → 2026-09-08 범위 확정) — status='hold' 중 전자계약이
  // 발송된 적이 있는 건 전부(서명 여부 무관, Stephen 확정) 골라내는 별도 차원의 조건.
  // status와 독립적인 파라미터라 URL도 별도로 관리.
  const contractPending = url.searchParams.get('contract_pending') === '1'
  // '신청대기' 칩(2026-09-08 신설) — 위 '계약대기'와 상호배타적인 파티션이 되도록, 전자계약을
  // 아예 보낸 적 없는 hold 예약만 남긴다. '신청대기' 칩이 선택된 경우에만 적용(전체·취소 등
  // 다른 칩에는 영향 없음) — 서명은 끝났지만 결제가 아직 안 된 예약이 '계약대기'에서 빠져
  // 다시 '신청대기'에만 보이던 오인 문제 해소(service-operations.md 관련 논의 참고).
  const isReservationPendingTab = status === 'hold' && !contractPending

  // confirmed 이후 상태는 /cms/rentals에서 관리 → 예약 목록에서 제외
  // draft(날짜 미정 임시예약)도 제외 — 고객이 체크아웃에서 날짜를 입력해 hold로 승격해야 관리자에게 노출됨(Default-Exclude)
  // p_exclude_statuses를 SQL WHERE에 반영해 LIMIT/OFFSET·total_count가 이 스코프 기준으로
  // 계산되도록 함(2026-08-07 페이지네이션 정합성 수정 — RPC에서 필터링 전 count를 쓰면
  // "총 N건"·페이지 수가 실제 표시 목록과 어긋남, migration 201 참고)
  const RENTAL_VIEW_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft']

  // '취소' 칩(2026-09-09 확장, Stephen 지시) — HOLD 30분 자동만료(release_reservation_hold,
  // service-operations.md §10)로 만료된 예약은 status='expired'로 전환되는데, 이 화면에
  // 'expired' 전용 탭이 없어 어느 필터에서도 조회할 수 없는 사각지대였다(만료 badge/라벨은
  // 이미 있었음 — STATUS_LABEL.expired, rental-lifecycle.md RSV-A-B1 — 표시만 되고 목록
  // 진입 경로가 없던 상태). 관리자 입장에서 "취소"와 "만료"는 둘 다 "이 예약은 더 이상
  // 진행되지 않는다"는 같은 성격이라, '취소' 칩을 status='cancelled' 단일값이 아니라
  // ['cancelled','expired'] 두 상태를 함께 보여주도록 확장한다 — 각 행 자체의 상태 배지는
  // STATUS_LABEL로 여전히 "취소"/"만료됨"으로 구분 표시되므로 두 상태를 섞어도 구분이 안
  // 되는 문제는 없다.
  const isCancelledTab = status === 'cancelled'

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:                          (status && !isCancelledTab) ? status : null,
    p_search:                          escapeLikePattern(search) || null,
    p_date_from:                       dateFrom || null,
    p_date_to:                         dateTo   || null,
    p_page:                            page,
    p_per_page:                        30,
    p_include_statuses:                isCancelledTab ? ['cancelled', 'expired'] : null,
    p_exclude_statuses:                RENTAL_VIEW_STATUSES,
    p_require_contract_sent_unsigned:  contractPending || null,
    p_exclude_contract_sent:           isReservationPendingTab || null,
  })

  if (error) console.error('[cms/reservation] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  await attachRentalDaysLabel(admin, rentals)
  const totalCount = rentals[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  // rental.change_cancel per-account 권한 판정
  let canChangeOrCancelReservation = true
  if (session?.user.id) {
    const { data: permData } = await admin
      .from('cms_menu_permissions')
      .select('menu_key, allowed')
      .eq('user_id', session.user.id)
    const menuOverrides = (permData ?? []) as CmsMenuPermissionOverride[]
    canChangeOrCancelReservation = hasMenuAccess(cmsRole, menuOverrides, 'rental.change_cancel')
  }

  return { rentals, totalCount, totalPages, status, search, dateFrom, dateTo, page, selectedId, cmsRole, contractPending, canChangeOrCancelReservation }
}

export const actions: Actions = {
  approveReservation: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))

    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     'confirmed',
    })

    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '처리 실패' })

    // 예약 승인 채팅 알림 + 고객 푸시 — 공용 헬퍼로 통합 (NTF-C2 수정, 2026-08-31)
    // mode='hold'(같은 주문의 다른 상품 미승인)이면 채팅·푸시 둘 다 보류 — service-operations.md §4/§15
    // fail-soft(2026-09-08 수정) — updateStatus 액션과 동일한 무한로딩 결함 방지(예약 id 139
    // 사례). 상태전이는 이미 위에서 성공했으므로 알림 실패가 "승인하기" 버튼 응답을 막으면 안 됨.
    try {
      const notifyPlan = await resolveApprovalNotifyPlan(admin, reservationId)
      await sendApprovalNotifications(admin, reservationId, notifyPlan)
    } catch { /* 승인 알림 발송 실패는 무시 */ }
    return { ok: true }
  },

  // 플랜 §3: 예약변경 — Toss 결제 취소 → revert_reservation_order_to_hold
  // manager+ 게이트, fail-soft 알림 포함
  changeReservation: async ({ request, locals }) => {
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
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin     = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data      = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const newStatus     = data.get('status') as string

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

    // 대여완료 포인트 자동적립 — returned 전이 시에만, fail-soft(공용 헬퍼가 내부 처리)
    // QR 반납 경로(rentalQrTransition.ts)도 동일하게 배선됨(log_rental_action과 동일 이중 배선)
    if (newStatus === 'returned') {
      try {
        await awardRentalCompletePoints(admin, reservationId)
      } catch { /* 포인트 적립 실패는 무시 */ }
    }

    // 상태 전환별 채팅 알림 자동 발송
    // cancelled·damage_claimed 추가(2026-08-18 검수 발견 — 상태만 바뀌고 고객 알림이 전혀
    // 없던 공백. HOLD 30분 자동만료는 release_reservation_hold RPC 내부에서 별도 발송)
    const AUTO_NOTIFY: Partial<Record<string, string>> = {
      shipped:          'shipment_notify',
      in_use:           'rental_confirm',
      return_requested: 'return_registration',
      returned:         'rental_complete',
      cancelled:        'reservation_cancelled',
      damage_claimed:   'damage_claimed',
    }
    // fail-soft(2026-09-08 수정) — 이 블록이 예외를 던지면 상태전이(이미 위에서 성공)는
    // DB에 반영됐음에도 액션 응답 직렬화가 깨져 클라이언트 use:enhance 콜백이 끝내 호출되지
    // 않고 "거부"/"예약 취소" 등 버튼이 무한로딩에 빠지는 결함이 실사용 중 발견됨(reservation
    // id 139) — log_rental_action(위 173행)과 동일한 fail-soft 원칙을 적용해 해소.
    const notifyType = AUTO_NOTIFY[newStatus]
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

    // ── 두발히어로 fail-soft 트리거 ─────────────────────────────────────────
    // shipped·return_requested·cancelled 전이 시 두발히어로 API 자동 호출.
    // API 실패는 예약 상태전이(이미 위에서 성공)에 영향을 주지 않는다 — 완전 격리.
    //
    // CRITICAL-1 수정 (2026-08-25): 기존 rental_reservations 단일 select에서
    // 존재하지 않는 컬럼(customer_name/addr 등) 조회로 42703 오류 → resRow=null →
    // 트리거 전체 스킵되던 버그를 getReservationForDhero() 공유 함수로 교체하여 수정.
    let dheroCancelFailed = false
    if (newStatus === 'shipped' || newStatus === 'return_requested' || newStatus === 'cancelled') {
      try {
        // 예약 정보 JOIN 조회 — user_profiles/user_shipping_addresses/products 포함
        // (rental_reservations에 고객명·주소·상품명이 직접 없음, 공유 모듈 사용)
        const res = await getReservationForDhero(admin, reservationId)

        if (res) {
          if (newStatus === 'shipped') {
            const isBulk = await isBulkDeliveryMethod(admin, res.pickupMethod)
            if (isBulk) {
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
                // placePageUrl이 있으면 고객 채팅으로 수령위치 등록 안내 전달 (fail-soft)
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
                console.error('[dhero/shipped] fail-soft:', e instanceof Error ? e.message : e)
              }
            }
          } else if (newStatus === 'return_requested') {
            const isBulk = await isBulkDeliveryMethod(admin, res.returnMethod)
            const trackingNumber = res.trackingNumber
            if (isBulk && trackingNumber) {
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
              } catch (e) {
                console.error('[dhero/return_requested] fail-soft:', e instanceof Error ? e.message : e)
              }
            }
          } else if (newStatus === 'cancelled') {
            const trackingNumber = res.trackingNumber
            if (trackingNumber) {
              try {
                await cancelDelivery(trackingNumber)
              } catch (e) {
                if (e instanceof DheroApiError && e.statusCode === 412) {
                  dheroCancelFailed = true
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
    }
    // ── dhero 트리거 끝 ────────────────────────────────────────────────────

    return { ok: true, ...(dheroCancelFailed ? { dhero_cancel_failed: true } : {}) }
  },

  clearIssuedContract: async ({ request, locals }) => {
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
