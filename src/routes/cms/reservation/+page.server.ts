import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { requestIdentityDocRegistration } from '$lib/server/identityDocRequest'
import { getDocGateStatus, type DocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { clearIssuedContractContent, discardSentContract, cancelIssuedContract } from '$lib/server/clearIssuedContractHelper'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { createDelivery, cancelDelivery, registerReturn, DheroApiError, DHERO_STATUS_LABEL } from '$lib/server/dhero'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'
import { isBulkDeliveryMethod } from '$lib/server/isBulkDeliveryMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { awardOnTimeReturnPoints } from '$lib/server/awardOnTimeReturnPoints'
import { attachRentalDaysLabel } from '$lib/server/rentalDaysLabel'
import { attachCancelPending } from '$lib/server/attachCancelPending'
import { resolveRepresentativeReservationId } from '$lib/server/resolveOrderRepresentative'
import { tossPaymentCancel } from '$lib/server/tossPaymentCancel'
import { rpcRetryWithFailSoftLog } from '$lib/server/rpcRetryWithFailSoftLog'
import { autoIssueContractOnApproval, hasAutoIssueTemplate, type AutoIssueResult } from '$lib/server/contractAutoIssue'

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
  const selectedRaw   = selectedParam ? parseInt(selectedParam, 10) : null
  // 목록은 "주문 1건 = 1행"(대표 예약)이므로 비대표 형제 id로 들어온 딥링크도 대표 행으로 연다(Migration 618)
  const selectedId    = selectedRaw != null && Number.isFinite(selectedRaw)
    ? await resolveRepresentativeReservationId(admin, selectedRaw)
    : null
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
  // '임시예약' 칩(status=draft, 2026-10-15)에서만 draft를 제외 목록에서 뺀다 — 그 외 칩('전체' 포함)은 기존대로 draft 제외
  const isDraftTab = status === 'draft'
  const RENTAL_VIEW_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', ...(isDraftTab ? [] : ['draft'])]

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

  // 임시예약 칩에서만 '임시-292'·'292' 형태 검색을 임시예약 id 조회로 처리한다(임시예약은 예약코드가 없어 화면 표시용 이름이 id 기반 — 2026-10-15)
  const draftIdMatch = isDraftTab ? search.trim().match(/^(?:임시-?)?(\d{1,15})$/) : null
  const draftIdSearch = draftIdMatch ? Number(draftIdMatch[1]) : null

  // 취소·만료된 예약을 가리키는 링크(?selected=)는 그 예약이 속한 칩으로 보낸다 — 결제완료 이력이 있으면 대여현황 '취소·환불', 없으면 이 화면 '취소'(Migration #714)
  if (selectedId != null) {
    const { data: selRow } = await admin.from('rental_reservations').select('status, payment_confirmed_at').eq('id', selectedId).maybeSingle()
    const sel = selRow as { status?: string; payment_confirmed_at?: string | null } | null
    if (sel?.status === 'cancelled' && sel.payment_confirmed_at != null) {
      throw redirect(303, `/cms/rentals?status=cancelled_refunded&selected=${selectedId}`)
    }
    if ((sel?.status === 'cancelled' || sel?.status === 'expired') && !isCancelledTab) {
      throw redirect(303, `/cms/reservation?status=cancelled&selected=${selectedId}`)
    }
  }

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:                          (status && !isCancelledTab) ? status : null,
    p_search:                          draftIdSearch != null ? null : (escapeLikePattern(search) || null),
    p_reservation_id:                  draftIdSearch,
    p_date_from:                       dateFrom || null,
    p_date_to:                         dateTo   || null,
    p_page:                            page,
    p_per_page:                        30,
    p_include_statuses:                isCancelledTab ? ['cancelled', 'expired'] : null,
    // '취소' 칩 = 결제완료 이력이 없는 취소·만료(예약신청·계약대기 단계 취소). 결제완료 후 취소·환불은 대여현황 '취소·환불' 칩(Migration #714)
    p_cancel_payment_scope:            isCancelledTab ? 'unpaid' : null,
    p_exclude_statuses:                RENTAL_VIEW_STATUSES,
    p_require_contract_sent_unsigned:  contractPending || null,
    p_exclude_contract_sent:           isReservationPendingTab || null,
    // 장바구니 다중 상품 = 하나의 코드품번·하나의 행(주문 단위 대표 행, Migration 618)
    p_group_by_order:                  true,
  })

  if (error) console.error('[cms/reservation] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  // 총 건수는 링크 예약 행을 앞에 붙이기 "전" 원 목록 기준으로 확정(붙인 행의 total_count는 항상 1)
  const totalCount = rentals[0]?.total_count ?? 0
  // 링크로 연 취소 예약이 이 페이지(30건)에 없으면 그 행만 따로 가져와 맨 위에 붙인다 — 목록에 없으면 패널이 열리자마자 닫힌다(총 건수·페이지 수는 영향 없음)
  // 계약대기 칩도 같은 보정 — 방금 계약서를 발송한 예약이 다음 페이지에 있어도 패널이 열려 있게 한다
  if (contractPending && selectedId != null && !rentals.some(r => r.reservation_id === selectedId)) {
    const { data: selOne, error: selErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null,
      p_page: 1, p_per_page: 1, p_include_statuses: ['hold'], p_reservation_id: selectedId,
      p_group_by_order: true,
    })
    if (selErr) console.error('[cms/reservation] 계약대기 링크 예약 조회 실패:', selErr.message)
    const one = ((selOne ?? []) as RentalListRow[])[0]
    if (one) rentals.unshift(one)
  }
  if (isCancelledTab && selectedId != null && !rentals.some(r => r.reservation_id === selectedId)) {
    const { data: selOne, error: selErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null,
      p_page: 1, p_per_page: 1, p_include_statuses: ['cancelled', 'expired'], p_reservation_id: selectedId,
      p_group_by_order: true,
    })
    if (selErr) console.error('[cms/reservation] 링크 예약 조회 실패:', selErr.message)
    const one = ((selOne ?? []) as RentalListRow[])[0]
    if (one) rentals.unshift(one)
  }
  // 고객 취소 요청 대기(서명+결제 후 취소 요청, Migration 687) — "취소대기" 배지·패널 안내
  await attachCancelPending(admin, rentals)
  await attachRentalDaysLabel(admin, rentals)
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

  // 칩별 '처리 대기' 건수(2026-10-19, 대여현황과 동일 방식): 신청대기=예약승인 대기, 계약대기=계약 발송·서명·결제 진행 대기. 주문 1건=1행 기준.
  // 검색어·기간 필터와 무관한 전체 건수다. 임시예약·취소·전체 칩은 관리자 조치 대기 개념이 없어 배지를 두지 않는다. 실패하면 배지 없이 둔다.
  const holdCountOf = async (pending: boolean): Promise<number | null> => {
    const { data, error: e } = await admin.rpc('get_rental_list', {
      p_status: 'hold', p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1,
      p_exclude_statuses: ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft'],
      p_require_contract_sent_unsigned: pending || null,
      p_exclude_contract_sent: !pending || null,
      p_group_by_order: true,
    })
    if (e) { console.error('[cms/reservation] 칩 건수 조회 실패:', e.message); return null }
    return ((data ?? []) as RentalListRow[])[0]?.total_count ?? 0
  }
  const [cHold, cContract] = await Promise.all([holdCountOf(false), holdCountOf(true)])
  const chipCounts: Record<string, number | null> = { hold: cHold, contract_pending: cContract }
  return { rentals, chipCounts, totalCount, totalPages, status, search, dateFrom, dateTo, page, selectedId, cmsRole, contractPending, canChangeOrCancelReservation }
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

    const admin     = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data      = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const newStatus     = data.get('status') as string

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

    // 상태 전환별 채팅 알림 자동 발송
    // cancelled·damage_claimed 추가(2026-08-18 검수 발견 — 상태만 바뀌고 고객 알림이 전혀
    // 없던 공백. HOLD 30분 자동만료는 release_reservation_hold RPC 내부에서 별도 발송)
    const AUTO_NOTIFY: Partial<Record<string, string>> = {
      shipped:          'shipment_notify',
      in_use:           'rental_confirm',
      return_requested: 'return_registration',
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
    let dheroBookFailedMsg: string | null = null
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
                if (!dheroBookFailedMsg) {
                  dheroBookFailedMsg = e instanceof DheroApiError
                    ? `두발히어로 배송 접수에 실패했습니다: ${e.message}`
                    : '두발히어로 배송 접수에 실패했습니다.'
                }
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

    return {
      ok: true,
      ...(dheroCancelFailed ? { dhero_cancel_failed: true } : {}),
      ...(dheroBookFailedMsg ? { dhero_book_failed: dheroBookFailedMsg } : {}),
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
