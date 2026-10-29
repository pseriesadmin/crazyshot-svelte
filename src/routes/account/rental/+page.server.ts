import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { isRealMemberSession } from '$lib/utils/authGuard'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'
import { loadCancelKinds, loadCancelRequestedIds, loadReservationOrderIds } from '$lib/server/cancelPolicyLoader'
import { groupRentalsByOrder, type RentalGroupItem } from '$lib/utils/groupRentalsByOrder'
import { buildJourneyStepDetails } from '$lib/utils/journeyStepInfo'
import { liveDheroBookings } from '$lib/utils/dheroLabels'
import type { DheroStageInfo } from '$lib/utils/dheroJourneyStage'
import { dheroStageForReservation } from '$lib/server/dheroStageForReservation'
import { loadPaymentReceipts, pickCardPayment, type CardPaymentInfo } from '$lib/server/account/loadPaymentReceipts'
import type { CancelKind } from '$lib/utils/canCancelReservation'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { toReturnSubmitMethod } from '$lib/utils/returnNotice'
import { RETURN_SUBMIT_STATUSES } from '$lib/server/returnSubmission'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export interface MyRental {
  id:                     string
  status:                 string
  reservation_code:       string
  start_date:             string | null
  end_date:               string | null
  return_method:          string | null
  return_time:            string | null
  created_at:             string
  product_name:           string | null
  product_category:       string | null
  has_signed_contract:    boolean
  // 서명 대기 중인 계약이 있을 때만 값이 있음 — /contract/{token} 서명화면 딥링크용
  pending_contract_token: string | null
  // 고객 셀프 예약신청취소 가능 여부 (서버에서 계산)
  canCancel:              boolean
  // 같은 주문(장바구니 1건)의 상품 목록 — 카드 1장에 모두 표시(2026-10-26)
  items:                  RentalGroupItem[]
  returnTargetId:         string
  /** 택배사(운송장 등록 시) — 단계 배지 설명용 */
  courier_code:           string | null
  /** 두발히어로 배송 5단계 진행 정보 — RentalJourneyStepper dheroStage prop에 전달 */
  dheroStage:             DheroStageInfo | null
  /** 단계 배지를 눌렀을 때 배지 아래에 보여줄 설명(상태 안내문 + 실제 정보) */
  journeyDetails:         Record<string, string[] | undefined>
  /** 카드 영수증·취소내역 버튼 정보 — 결제 행이 없으면(신청대기 등) null */
  payment:                CardPaymentInfo | null
  cancelKind:             CancelKind
  cancelRequested:        boolean
  /** 고객이 취소했고 관리자 취소확인 전 — "취소중" 비활성 카드 */
  cancelling:             boolean
  tracking_number:        string | null
  /** 반납정보 등록 화면 대상(대여중·반납요청 + 택배·퀵·무인함 방식) */
  returnSubmittable:      boolean
  /** 이미 반납정보를 제출함 */
  returnSubmitted:        boolean
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  // 익명(채팅 게스트) 세션은 가입 전 계정이라 예약이 없다 — 빈 목록 대신 로그인으로 보낸다(문자·알림 링크를 게스트 세션 브라우저로 열 때, 2026-10-27)
  if (!isRealMemberSession(session)) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, return_method, return_time, created_at:submitted_at, product_id, tracking_number, courier_code, dhero_status_code, dhero_meta, dhero_return_book_id, pickup_method, pickup_time, customer_cancelled_at, cancel_confirmed_at, cancel_requested_at, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
    .eq('user_id', session.user.id)
    // 취소중(고객이 취소했고 관리자 확인 전) 예약도 목록에 남긴다 — 관리자가 취소확인하면 /account/cancel로 이동
    .or('status.in.(hold,confirmed,shipped,in_use,return_requested,returned,completed),and(status.eq.cancelled,customer_cancelled_at.not.is.null,cancel_confirmed_at.is.null)')
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error) {
    return { rentals: [] as MyRental[] }
  }

  // 두발히어로 쪽에서 취소된 접수번호는 고객에게 운송장으로 보여주지 않는다(취소돼도 번호는 남아 있음 — CMS 재접수 시 새 번호로 바뀜, 2026-10-27)
  const liveBookingIds = new Set(
    liveDheroBookings(((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: String(r.id),
      trackingNumber: (r.tracking_number as string | null) ?? null,
      courierCode: (r.courier_code as string | null) ?? null,
      dheroMeta: (r.dhero_meta as Record<string, unknown> | null) ?? null,
    }))).map(u => u.id),
  )

  // 두발히어로 raw 필드 맵 — 그룹 레벨에서 cardStatus(g.status)로 재계산 시 사용 (MINOR-3)
  const rawDheroById = new Map(
    ((data ?? []) as Array<Record<string, unknown>>)
      .filter(r => liveBookingIds.has(String(r.id)))
      .map(r => [String(r.id), {
        id:                String(r.id),
        trackingNumber:    (r.tracking_number as string | null) ?? null,
        courierCode:       (r.courier_code as string | null) ?? null,
        dheroStatusCode:   (r.dhero_status_code as number | null) ?? null,
        dheroMeta:         (r.dhero_meta as { bookId?: unknown; canceledAt?: unknown; accidentAt?: unknown } | null) ?? null,
        dheroReturnBookId: (r.dhero_return_book_id as string | null) ?? null,
      }] as const),
  )

  // 자식 재고의 이름·분류는 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-B)
  await applyParentFieldsToRowProducts(data ?? [], ['name', 'category'])

  const reservationIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string | number)

  // 카드에 "전자계약 확인"(서명완료) 또는 "전자계약 서명하기"(서명대기) 버튼을 노출할지 판단
  const contractStatus = await loadRentalContractStatus(locals.supabase, reservationIds)

  // 취소 판정 (2026-09-30 정책: 수령 신청 마감 전 즉시취소 / 마감 후·대여 시작 후 문의) — 같은 주문 형제 예약 포함
  const nowMs = Date.now()
  const cancelKinds = await loadCancelKinds(
    locals.supabase,
    ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string | number,
      status: r.status as string,
      tracking_number: (r.tracking_number as string | null) ?? null,
      start_date: (r.start_date as string | null) ?? null,
      pickup_method: (r.pickup_method as string | null) ?? null,
    })),
    nowMs,
  )

  // 마감 후 취소 요청(②구간)이 이미 접수된 예약 — 버튼 대신 "접수됨" 표시
  const cancelRequestedIds = await loadCancelRequestedIds(locals.supabase, reservationIds)

  // 반납정보 등록 대상 예약의 제출 여부 — 제출 테이블은 RLS 정책이 없어 서버(서비스 롤)로만 읽는다
  const submittableIds = ((data ?? []) as Array<Record<string, unknown>>)
    .filter(r => RETURN_SUBMIT_STATUSES.has(r.status as string) && toReturnSubmitMethod(r.return_method as string | null) !== null)
    .map(r => r.id as number)
  const submittedIds = new Set<string>()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (submittableIds.length > 0 && serviceRoleKey) {
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const { data: subs } = await admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', submittableIds)
    for (const x of (subs ?? []) as Array<{ reservation_id: number }>) submittedIds.add(String(x.reservation_id))
  }

  const rows: Array<Omit<MyRental, 'items' | 'returnTargetId' | 'payment' | 'journeyDetails'>> = (data ?? []).map((r: Record<string, unknown>) => {
    const product = (r.products as { name: string; category: string } | null) ?? null
    const status = contractStatus.get(String(r.id))
    const isLive = liveBookingIds.has(String(r.id))
    return {
      id:                     r.id as string,
      status:                 r.status as string,
      reservation_code:       r.reservation_code as string,
      start_date:             r.start_date as string | null,
      end_date:               r.end_date as string | null,
      return_method:          r.return_method as string | null,
      return_time:            r.return_time as string | null,
      created_at:             r.created_at as string,
      product_name:           product?.name ?? null,
      product_category:       product?.category ?? null,
      has_signed_contract:    status?.signed ?? false,
      pending_contract_token: status?.pendingToken ?? null,
      tracking_number:        isLive ? (r.tracking_number as string | null) : null,
      courier_code:           isLive ? ((r.courier_code as string | null) ?? null) : null,
      dheroStage:             null, // 그룹 레벨에서 cardStatus(g.status) 기준으로 재계산 (MINOR-3)
      returnSubmittable:      RETURN_SUBMIT_STATUSES.has(r.status as string) && toReturnSubmitMethod(r.return_method as string | null) !== null,
      returnSubmitted:        submittedIds.has(String(r.id)),
      cancelKind: cancelKinds.get(String(r.id)) ?? 'unavailable',
      cancelRequested: cancelRequestedIds.has(String(r.id)),
      cancelling: (r.status === 'cancelled' && !!r.customer_cancelled_at && !r.cancel_confirmed_at) || (r.status !== 'cancelled' && !!r.cancel_requested_at),
      canCancel: (cancelKinds.get(String(r.id)) ?? 'unavailable') === 'free',
    }
  })

  // 같은 주문의 예약은 카드 1장으로 묶는다(주문 1건 = 대여 카드 1장, service-operations §4)
  const orderIds = await loadReservationOrderIds(locals.supabase, reservationIds)
  const grouped = groupRentalsByOrder(rows, orderIds)
  // 카드 영수증·취소내역 — 결제 행이 있는 카드에만 버튼 노출(서버 전용 서비스 롤, 최소 정보만 내려감)
  const payments = serviceRoleKey
    ? await loadPaymentReceipts(createClient(getSupabaseUrl(), serviceRoleKey), session.user.id, reservationIds)
    : new Map<string, CardPaymentInfo>()
  const rowById = new Map(rows.map(r => [String(r.id), r]))
  const rentals: MyRental[] = grouped.map(g => {
    // 운송장은 같은 주문의 구성원 중 등록된 첫 번째 값을 쓴다(두발히어로 접수는 주문 단위)
    const tracked = g.items.map(i => rowById.get(String(i.id))).find(r => !!r?.tracking_number)
    // dheroStage: g.status(카드 대표 상태)로 재계산 — row-level r.status 사용 금지 (MINOR-3)
    const trackedRaw = tracked ? rawDheroById.get(String(tracked.id)) : undefined
    return {
      ...g,
      dheroStage: trackedRaw ? dheroStageForReservation({ ...trackedRaw, cardStatus: g.status }) : null,
      payment: pickCardPayment(g.items.map(i => i.id), payments),
      journeyDetails: buildJourneyStepDetails({
        status: g.status, start_date: g.start_date, end_date: g.end_date, created_at: g.created_at, return_time: g.return_time,
        tracking_number: tracked?.tracking_number ?? g.tracking_number, courier_code: tracked?.courier_code ?? g.courier_code,
      }),
    }
  })

  return { rentals }
}
