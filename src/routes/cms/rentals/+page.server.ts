import { attachCancelPending } from '$lib/server/attachCancelPending'
import { attachPriorIssue } from '$lib/server/attachPriorIssue'
import { loadCsReservationIds } from '$lib/server/csRegistered'
import { attachReturnStage, RETURN_STAGE_RANK } from '$lib/server/attachReturnStage'
import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { approveInspection } from '$lib/server/inspection'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { clearIssuedContractContent } from '$lib/server/clearIssuedContractHelper'
import { attachRentalDaysLabel } from '$lib/server/rentalDaysLabel'
import { resolveRepresentativeReservationId } from '$lib/server/resolveOrderRepresentative'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import { isReturnDue } from '$lib/utils/returnDue'
import { loadReservationStageRows, loadReservationChipCounts } from '$lib/server/cms/reservationStageList'

import type { RentalListRow } from '../reservation/+page.server'
export type { RentalListRow }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole, session } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin  = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  // 통합 예약·대여현황(2026-10-22): 화면 최초진입(URL에 ?status= 자체가 없음) 기본값 = '신청대기'(hold) — 예약 단계부터 대여 단계까지 한 화면.
  // '전체' 칩 클릭 시에는 +page.svelte가 status=''를 명시적으로 params에 채워 보내므로
  // url.searchParams.has('status')가 true가 되어 이 기본값으로 되돌아가지 않는다.
  const status = url.searchParams.has('status') ? (url.searchParams.get('status') ?? '') : 'hold'
  // '전체' 칩은 없앴다(2026-10-22) — 옛 '전체'(status=) 링크는 기본 칩인 '신청대기'로 보낸다(예약만 가리키는 링크는 아래에서 그 예약이 속한 칩으로 다시 이동)
  if (url.searchParams.has('status') && url.searchParams.get('status') === '') {
    const u = new URL(url)
    u.searchParams.delete('status')
    throw redirect(303, `${u.pathname}${u.search}`)
  }
  // 옛 예약현황의 '취소' 칩 값(cancelled)으로 들어온 링크는 통합된 '취소·환불·CS' 칩으로 보낸다
  if (status === 'cancelled') {
    const u = new URL(url)
    u.searchParams.set('status', 'cancelled_refunded')
    throw redirect(303, `${u.pathname}${u.search}`)
  }
  // 옛 칩 값(반납요청·반납완료)으로 들어온 링크는 통합된 '반납중' 칩으로 보낸다(2026-10-19)
  if (status === 'return_requested' || status === 'returned') {
    const u = new URL(url)
    u.searchParams.set('status', 'returning')
    throw redirect(303, `${u.pathname}${u.search}`)
  }
  const search = url.searchParams.get('search') ?? ''
  const dateFrom = url.searchParams.get('date_from') ?? ''
  const dateTo   = url.searchParams.get('date_to') ?? ''
  // '계약대기' 칩 = status=hold + contract_pending=1(전자계약이 발송된 적 있는 신청대기) — 기존 예약현황 URL 규칙 그대로
  const contractPending = url.searchParams.get('contract_pending') === '1'
  const page   = parseInt(url.searchParams.get('page') ?? '1', 10)
  const selectedParam = url.searchParams.get('selected')
  const selectedRaw   = selectedParam ? parseInt(selectedParam, 10) : null
  // 목록은 "주문 1건 = 1행"(대표 예약)이므로 비대표 형제 id로 들어온 딥링크도 대표 행으로 연다(Migration 618)
  const selectedId    = selectedRaw != null && Number.isFinite(selectedRaw)
    ? await resolveRepresentativeReservationId(admin, selectedRaw)
    : null

  // 대여 라이프사이클 전용: 예약 단계(pending/hold/cancelled)는 /cms/reservation에서 관리
  // p_include_statuses를 SQL WHERE에 반영해 LIMIT/OFFSET·total_count가 이 스코프 기준으로
  // 계산되도록 함(2026-08-07 페이지네이션 정합성 수정 — RPC에서 필터링 전 count를 쓰면
  // "총 N건"·페이지 수가 실제 표시 목록과 어긋남, migration 201 참고)
  const RENTAL_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

  // '취소·환불' 칩(status=cancelled_refunded, 2026-10-14): 관리자·고객이 취소한 예약 전부(결제 전 취소 포함).
  // 환불까지 완료된 건은 행 배지가 '취소·환불', 결제 전 취소는 '취소'로 구분된다(payment_status). 칩 필터는 기존 get_rental_list의
  // p_status·p_include_statuses(cancelled)로 처리 — 총 건수·페이지네이션도 그대로 맞는다.
  const isCancelledView = status === 'cancelled_refunded'
  // 통합: 예약 단계 칩('임시예약'·'신청대기'·'계약대기')과 '전체' 칩
  const isDraftView = status === 'draft'
  const isHoldView = status === 'hold'
  // '검수' 칩(status=inspection, 2026-10-17, Migration #724): 반납완료(returned) 중 검수 이슈가 등록된 건. '반납완료' 칩은 검수 대기 건만 보여준다.
  const isInspectionView = status === 'inspection'
  // '반납중' 칩(status=returning, 2026-10-19): 반납요청 + 반납완료(검수 대기) + 반납 예정일 도래·알림 발송된 대여중. 검수 이슈 건은 '검수' 칩으로 간다.
  const isReturningView = status === 'returning'

  // CS 접수 등록 건(완료되면 '취소·환불·CS' 칩으로 분류) — 완료 칩에서는 빼고 CS 칩에는 앞에 붙인다
  const csIds = await loadCsReservationIds(admin)

  // 칩(?status=) 없이 예약만 가리키는 링크(채팅 카드·알림·옛 북마크 — 예약현황/대여현황이 합쳐지기 전 주소 포함)는 그 예약이 속한 칩으로 보낸다
  if (selectedId != null && !url.searchParams.has('status')) {
    const { data: one, error: oneErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1,
      p_reservation_id: selectedId, p_group_by_order: true,
    })
    if (oneErr) console.error('[cms/rentals] 링크 예약 칩 조회 실패:', oneErr.message)
    const row = ((one ?? []) as RentalListRow[])[0]
    if (row) {
      let chip = 'completed' // 파손신고 등 그 밖의 종결 상태는 '완료' 칩
      const own = row.own_status ?? row.status
      if (own === 'draft') chip = 'draft'
      else if (own === 'hold') chip = 'hold'
      else if (own === 'cancelled' || own === 'expired') chip = 'cancelled_refunded'
      else if (own === 'confirmed' || own === 'shipped') chip = own
      else if (own === 'in_use') chip = isReturnDue(row.rental_end, row.return_time) ? 'returning' : 'in_use'
      else if (own === 'return_requested') chip = 'returning'
      else if (own === 'returned') chip = row.status === 'returned' && csIds.has(selectedId) ? 'inspection' : 'returning'
      else if (own === 'completed') chip = csIds.has(selectedId) ? 'cancelled_refunded' : 'completed'
      const target = new URLSearchParams()
      target.set('status', chip)
      if (chip === 'hold') {
        const { data: ap } = await admin.from('rental_reservations').select('approved_at').eq('id', selectedId).maybeSingle()
        if (row.signing_sent_at || (ap as { approved_at?: string | null } | null)?.approved_at) target.set('contract_pending', '1')
      }
      for (const [k, v] of url.searchParams) if (k !== 'status') target.set(k, v)
      throw redirect(303, `/cms/rentals?${target.toString()}`)
    }
  }

  // 예약을 가리키는 링크(?selected=)로 들어왔는데 그 예약이 이미 취소·만료 상태라면 '취소·환불·CS' 칩으로 전환해 연다
  // (취소된 예약은 다른 칩 목록에 없어 패널이 열리지 않던 문제 — 통합 후에는 결제 전 취소·만료도 이 칩에 있다). 칩 클릭 시에는 화면이 selected를 지우므로 칩 이동이 막히지 않는다.
  if (selectedId != null && !isCancelledView) {
    const { data: selRow } = await admin.from('rental_reservations').select('status').eq('id', selectedId).maybeSingle()
    const selStatus = (selRow as { status?: string } | null)?.status
    if (selStatus === 'cancelled' || selStatus === 'expired') {
      throw redirect(303, `/cms/rentals?status=cancelled_refunded&selected=${selectedId}`)
    }
  }

  // 링크(?selected=)로 연 반납완료 예약이 현재 칩과 맞지 않으면(이슈 등록 ↔ 검수 대기 ↔ 완료) 알맞은 칩으로 전환해 연다
  if (selectedId != null && (isReturningView || isInspectionView || status === 'completed')) {
    const { data: insRow } = await admin.from('rental_reservations').select('status, inspection_status').eq('id', selectedId).maybeSingle()
    const ir = insRow as { status?: string; inspection_status?: string | null } | null
    if (ir?.status === 'returned') {
      const isIssue = ir.inspection_status === 'issue'
      if (isIssue && isReturningView) throw redirect(303, `/cms/rentals?status=inspection&selected=${selectedId}`)
      if (!isIssue && isInspectionView) throw redirect(303, `/cms/rentals?status=returning&selected=${selectedId}`)
    } else if (ir?.status === 'completed' && (isReturningView || isInspectionView)) {
      throw redirect(303, `/cms/rentals?status=${csIds.has(selectedId) ? 'cancelled_refunded' : 'completed'}&selected=${selectedId}`)
    }
  }
  // 완료된 CS 접수 건은 '완료'가 아니라 '취소·환불·CS' 칩에 속한다 — 링크로 연 예약이 칩과 맞지 않으면 알맞은 칩으로 전환
  if (selectedId != null && (status === 'completed' || isCancelledView) && csIds.has(selectedId)) {
    const { data: stRow } = await admin.from('rental_reservations').select('status').eq('id', selectedId).maybeSingle()
    if ((stRow as { status?: string } | null)?.status === 'completed' && status === 'completed') {
      throw redirect(303, `/cms/rentals?status=cancelled_refunded&selected=${selectedId}`)
    }
  }

  // 예약 단계 칩(임시예약·신청대기·계약대기)은 기존 예약현황 조회 규칙 그대로(공용 모듈) — 그 밖의 칩은 대여 라이프사이클·취소·전체 조회
  let rentals: RentalListRow[]
  let totalCount: number
  if (isDraftView || isHoldView) {
    const stage = await loadReservationStageRows(admin, {
      status: isDraftView ? 'draft' : 'hold', contractPending, search, dateFrom, dateTo, page, selectedId,
    })
    rentals = stage.rentals
    totalCount = stage.totalCount
  } else {
    const { data: rows, error } = await admin.rpc('get_rental_list', {
      p_status:           isCancelledView ? null : isInspectionView ? 'returned' : (isReturningView || status === 'completed') ? null : (status || null),
      // '대여중' 칩은 반납 일시가 지나 '반납중' 칩으로 옮겨간 예약을 뺀다(Migration #735 in_use_pending)
      p_inspection_scope: isInspectionView ? 'issue' : (isReturningView ? 'returning' : (status === 'in_use' ? 'in_use_pending' : null)),
      p_search:           escapeLikePattern(search) || null,
      p_date_from:        dateFrom || null,
      p_date_to:          dateTo || null,
      p_page:             page,
      p_per_page:         30,
      // '취소·환불·CS' 칩 = 결제 전 취소·만료 + 결제 후 취소·환불(+완료된 CS 접수 건)
      p_include_statuses: isCancelledView ? ['cancelled', 'expired'] : isReturningView ? ['in_use', 'return_requested', 'returned'] : status === 'completed' ? ['completed', 'damage_claimed'] : RENTAL_STATUSES, // '완료' 칩 = 완료 + 파손신고(옛 '전체' 칩에만 보이던 건)
      // 장바구니 다중 상품 = 하나의 코드품번·하나의 행(주문 단위 대표 행, Migration 618)
      p_group_by_order:   true,
    })
    if (error) console.error('[cms/rentals] get_rental_list error:', error.message)
    rentals = (rows ?? []) as RentalListRow[]
    // 총 건수·페이지 수는 취소중 행을 앞에 붙이기 "전"의 원 목록 기준으로 확정한다 — 취소중 행은
    // get_rental_list(p_reservation_id)로 1건씩 가져와 그 행의 total_count가 항상 1이라, 붙인 뒤 계산하면
    // "총 N건"과 페이지 수가 틀어진다(QA B-1).
    totalCount = rentals[0]?.total_count ?? 0
  }

  if (status === 'completed' && csIds.size > 0) {
    // CS 접수 건은 완료 칩에서 제외 — 총 건수도 같은 만큼 뺀다(페이지 안 행 수는 30건보다 적을 수 있다)
    const before = rentals.length
    for (let i = rentals.length - 1; i >= 0; i--) if (csIds.has(rentals[i].reservation_id)) rentals.splice(i, 1)
    totalCount = Math.max(0, totalCount - (before - rentals.length))
  }
  if (isCancelledView && page === 1 && !search && csIds.size > 0) {
    // 완료 상태가 된 CS 접수 건 — 취소·환불 목록 맨 앞에 붙인다(주문 1건 = 1행이라 대표 행 id 기준으로 중복 제거)
    const { data: doneRows } = await admin.from('rental_reservations').select('id').eq('status', 'completed').in('id', [...csIds]).order('id', { ascending: false }).limit(60)
    const seen = new Set<number>(rentals.map(r => r.reservation_id))
    const added: RentalListRow[] = []
    for (const d of (doneRows ?? []) as { id: number }[]) {
      const repId = await resolveRepresentativeReservationId(admin, d.id)
      if (seen.has(repId)) continue
      const { data: one } = await admin.rpc('get_rental_list', {
        p_status: null, p_search: null, p_date_from: null, p_date_to: null,
        p_page: 1, p_per_page: 1, p_include_statuses: RENTAL_STATUSES, p_reservation_id: repId, p_group_by_order: true,
      })
      const row = ((one ?? []) as RentalListRow[])[0]
      if (row && row.status === 'completed') { seen.add(repId); added.push(row) }
    }
    rentals.unshift(...added)
    totalCount += added.length
  }

  // 링크로 연 예약이 이 페이지(1페이지 30건)에 없으면(취소 건이 많아 다음 페이지에 있는 경우) 그 행만 따로 가져와 맨 위에 붙인다 —
  // 목록에 없으면 패널이 열리자마자 닫히므로. 총 건수·페이지 수는 영향 없음(원 목록 기준으로 이미 확정).
  if (isCancelledView && selectedId != null && !rentals.some(r => r.reservation_id === selectedId)) {
    const { data: selOne, error: selErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null,
      p_page: 1, p_per_page: 1, p_include_statuses: ['cancelled', 'expired'], p_reservation_id: selectedId,
      p_group_by_order: true,
    })
    if (selErr) console.error('[cms/rentals] 링크 예약 조회 실패:', selErr.message)
    const one = ((selOne ?? []) as RentalListRow[])[0]
    if (one) rentals.unshift(one)
  }
  // 고객이 취소했고 관리자 취소확인 전인 예약("취소중") — 대여 라이프사이클 스코프(cancelled 제외)와 별개로
  // 목록 최상단에 "예약취소" 배지로 노출해 관리자가 놓치지 않게 한다(첫 페이지, 검색어 없음, 전체/계약완료 칩에서만).
  // 헤더의 [예약취소] 버튼 = 관리자 취소확인(confirm-cancel API) → 고객 마이페이지에서 "취소" 화면으로 이동.
  // 통합 후 '전체' 칩에는 취소 건이 목록에 직접 들어 있어 중복되므로 '계약완료' 칩에서만 따로 붙인다
  if (page === 1 && !search && status === 'confirmed') {
    const { data: pendingRows, error: pendingErr } = await admin
      .from('rental_reservations')
      .select('id')
      .eq('status', 'cancelled')
      .not('customer_cancelled_at', 'is', null)
      .is('cancel_confirmed_at', null)
      .order('customer_cancelled_at', { ascending: false })
      .limit(20)
    if (pendingErr) console.error('[cms/rentals] 취소중 예약 조회 실패:', pendingErr.message)
    const pendingIds = ((pendingRows ?? []) as Array<{ id: number }>).map(r => r.id)
    if (pendingIds.length > 0) {
      const fetched = await Promise.all(pendingIds.map(async (id) => {
        const { data, error: pendingListErr } = await admin.rpc('get_rental_list', {
          p_status: null, p_search: null, p_date_from: null, p_date_to: null,
          p_page: 1, p_per_page: 1, p_include_statuses: ['cancelled'], p_reservation_id: id,
          // 주문 단위 취소이므로 대표 행 1개로 묶어 가져온다(같은 주문의 형제가 각각 "취소중" 행으로 중복 노출되지 않게)
          p_group_by_order: true,
          p_cancel_payment_scope: 'paid',
        })
        if (pendingListErr) console.error('[cms/rentals] 취소중 예약 상세 조회 실패:', id, pendingListErr.message)
        return ((data ?? []) as RentalListRow[])[0] ?? null
      }))
      const seenPending = new Set<number>()
      const pending = fetched
        .filter((r): r is RentalListRow => r !== null)
        .filter((r) => (seenPending.has(r.reservation_id) ? false : (seenPending.add(r.reservation_id), true)))
        .map(r => ({ ...r, cancel_pending: true }))
      rentals.unshift(...pending)
    }
  }
  // '취소·환불' 칩: 고객이 취소했고 관리자 취소확인 전인 행은 "취소중"(cancel_pending)로 표시 — 헤더 [예약취소] = 취소확인 흐름 유지
  if (isCancelledView && rentals.length > 0) {
    const { data: pendRows, error: pendErr } = await admin
      .from('rental_reservations')
      .select('id')
      .in('id', rentals.map(r => r.reservation_id))
      .not('customer_cancelled_at', 'is', null)
      .is('cancel_confirmed_at', null)
    if (pendErr) console.error('[cms/rentals] 취소중 표시 조회 실패:', pendErr.message)
    const pendSet = new Set(((pendRows ?? []) as Array<{ id: number }>).map(r => r.id))
    for (const r of rentals) if (pendSet.has(r.reservation_id)) r.cancel_pending = true
  }
  // 고객 취소 요청 대기(서명+결제 후 취소 요청, Migration 687) — "취소대기" 배지 + 목록 상단 정렬
  await attachCancelPending(admin, rentals)
  // CS 사전 이슈 접수 표식("사전접수건", 3단계) — 검수 칩에서는 목록 상단에 모아 담당자가 먼저 보게 한다
  await attachPriorIssue(admin, rentals)
  // 반납 진행 단계 배지(반납요청 예정/발송, 반납등록) — '반납중' 칩에서는 예정 → 발송 → 등록 순으로 정렬
  await attachReturnStage(admin, rentals)
  rentals.sort((a, b) =>
    (Number(!!b.cancel_pending) - Number(!!a.cancel_pending)) ||
    (isReturningView ? (RETURN_STAGE_RANK[a.return_stage ?? 'registered'] ?? 3) - (RETURN_STAGE_RANK[b.return_stage ?? 'registered'] ?? 3) : 0) ||
    (isInspectionView ? Number(!!b.prior_issue) - Number(!!a.prior_issue) : 0))
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

  // 칩별 '처리 대기' 건수(2026-10-19, Stephen 확정 — 열람 여부와 무관): 계약완료=반출 대기, 배송중=수령 확인 대기,
  // 대여중=반납 일시 전 대여중 전체, 반납중=반납요청·회수·검수 대기 전체, 검수=이슈 등록 건. 주문 1건=1행 기준(목록 총건수와 같은 방식). 실패한 칩은 배지 없이 둔다.
  const countOf = async (args: Record<string, unknown>): Promise<number | null> => {
    const { data, error: e } = await admin.rpc('get_rental_list', {
      p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1, p_group_by_order: true, ...args,
    })
    if (e) { console.error('[cms/rentals] 칩 건수 조회 실패:', e.message); return null }
    return ((data ?? []) as RentalListRow[])[0]?.total_count ?? 0
  }
  const [cConfirmed, cShipped, cReturning, cInspection, cInUse] = await Promise.all([
    countOf({ p_status: 'confirmed', p_include_statuses: RENTAL_STATUSES }),
    countOf({ p_status: 'shipped', p_include_statuses: RENTAL_STATUSES }),
    countOf({ p_status: null, p_inspection_scope: 'returning', p_include_statuses: ['in_use', 'return_requested', 'returned'] }),
    countOf({ p_status: 'returned', p_inspection_scope: 'issue', p_include_statuses: RENTAL_STATUSES }),
    // 대여중 = 반납 일시 전(반납중으로 옮겨가지 않은) 대여중 전체 — 다른 칩과 같이 목록 건수를 표시
    countOf({ p_status: 'in_use', p_inspection_scope: 'in_use_pending', p_include_statuses: RENTAL_STATUSES }),
  ])
  // '완료' 칩 수량 = 오늘(KST) 완료된 건수(2026-10-22, Stephen 지시) — 완료 시각은 검수 승인·이슈 해소 시각(inspected_at), 없으면 마지막 갱신 시각. 주문 1건=1건, CS 접수 건('취소·환불·CS' 칩)은 제외.
  const countCompletedToday = async (): Promise<number | null> => {
    const startKst = new Date(`${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00+09:00`).toISOString()
    const { data: doneRows, error: doneErr } = await admin
      .from('rental_reservations')
      .select('id')
      .eq('status', 'completed')
      .or(`inspected_at.gte.${startKst},and(inspected_at.is.null,updated_at.gte.${startKst})`)
      .limit(2000)
    if (doneErr) { console.error('[cms/rentals] 오늘 완료 건수 조회 실패:', doneErr.message); return null }
    const ids = ((doneRows ?? []) as { id: number }[]).map((r) => r.id).filter((id) => !csIds.has(id))
    if (ids.length === 0) return 0
    const { data: oi } = await admin.from('order_items').select('order_id, reservation_id').in('reservation_id', ids)
    const orderOf = new Map(((oi ?? []) as { order_id: number | null; reservation_id: number }[]).map((r) => [r.reservation_id, r.order_id]))
    return new Set(ids.map((id) => (orderOf.get(id) != null ? `o${orderOf.get(id)}` : `r${id}`))).size
  }
  // '취소·환불·CS' 칩 수량 = 오늘(KST) 이 칩에 들어온 건수(2026-10-22, Stephen 지시) — 오늘 취소·만료된 예약 + 오늘 완료된 CS 접수 건. 취소·만료 시각은 마지막 상태 갱신 시각(updated_at)이다. 주문 1건=1건.
  const countCancelCsToday = async (): Promise<number | null> => {
    const startKst = new Date(`${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00+09:00`).toISOString()
    const { data: canRows, error: canErr } = await admin
      .from('rental_reservations')
      .select('id')
      .in('status', ['cancelled', 'expired'])
      .gte('updated_at', startKst)
      .limit(2000)
    if (canErr) { console.error('[cms/rentals] 오늘 취소 건수 조회 실패:', canErr.message); return null }
    const ids = new Set<number>(((canRows ?? []) as { id: number }[]).map((r) => r.id))
    if (csIds.size > 0) {
      const { data: csDone } = await admin
        .from('rental_reservations')
        .select('id')
        .eq('status', 'completed')
        .in('id', [...csIds])
        .or(`inspected_at.gte.${startKst},and(inspected_at.is.null,updated_at.gte.${startKst})`)
      for (const r of (csDone ?? []) as { id: number }[]) ids.add(r.id)
    }
    if (ids.size === 0) return 0
    const { data: oi } = await admin.from('order_items').select('order_id, reservation_id').in('reservation_id', [...ids])
    const orderOf = new Map(((oi ?? []) as { order_id: number | null; reservation_id: number }[]).map((r) => [r.reservation_id, r.order_id]))
    return new Set([...ids].map((id) => (orderOf.get(id) != null ? `o${orderOf.get(id)}` : `r${id}`))).size
  }
  const completedToday = await countCompletedToday()
  const cancelCsToday = await countCancelCsToday()
  const reservationCounts = await loadReservationChipCounts(admin)
  const chipCounts: Record<string, number | null> = {
    ...reservationCounts,
    completed: completedToday,
    cancelled_refunded: cancelCsToday,
    confirmed: cConfirmed, shipped: cShipped, in_use: cInUse, returning: cReturning, inspection: cInspection,
  }
  return { rentals, chipCounts, totalCount, totalPages, status, search, dateFrom, dateTo, contractPending, page, selectedId, cmsRole, canChangeOrCancelReservation }
}

export const actions: Actions = {
  sendChatNotify: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'rental.reservation')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const notifyType    = data.get('notify_type') as string

    // 수동 알림은 해당 대여 단계에서만 보낸다(화면 버튼 활성 규칙 RentalDetailPanel NOTIFY_BUTTONS와 동일 — 화면만 막으면 직접 호출로 우회된다)
    const NOTIFY_ALLOWED_STATUSES: Record<string, readonly string[]> = {
      shipment_notify:     ['confirmed'],
      return_remind:       ['in_use', 'return_requested'],
      return_registration: ['return_requested'],
      rental_complete:     ['return_requested', 'returned'],
    }
    const allowed = NOTIFY_ALLOWED_STATUSES[notifyType]
    if (allowed) {
      const { data: stRow } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
      const st = (stRow as { status?: string } | null)?.status
      if (!st || !allowed.includes(st)) return fail(400, { message: '이 알림은 현재 예약 단계에서 보낼 수 없습니다.' })
    }

    // '대여 종료 알림'(2026-10-21, Stephen 확정) = 반납 검수 승인과 같은 동작 — 예약을 '완료'로 옮기고 대여 종료(완료) 안내를 고객에게 보낸다.
    // 승인자·시각이 남고 포인트가 적립되며, 검수 이슈가 등록된 건은 거절된다(이슈 해소 후 완료). 완료 판정은 항상 DB 검수 규칙을 거친다.
    if (notifyType === 'rental_complete') {
      if (!hasSettingsAccess(cmsRole)) return fail(403, { message: '대여 종료 처리는 매니저 이상만 할 수 있습니다.' })
      const done = await approveInspection(admin, reservationId, session.user.id)
      if (!done.ok) return fail(409, { message: done.error ?? '대여 종료 처리에 실패했습니다.' })
      return { ok: true, completed: true }
    }

    const { data: result, error } = await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type:    notifyType,
    })

    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '알림 발송 실패' })
    // 수동 발송 푸시 알림 병행 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
    await sendReservationLifecyclePush(admin, reservationId, notifyType)
    return { ok: true }
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
}
