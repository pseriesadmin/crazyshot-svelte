import { attachCancelPending } from '$lib/server/attachCancelPending'
import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { clearIssuedContractContent } from '$lib/server/clearIssuedContractHelper'
import { attachRentalDaysLabel } from '$lib/server/rentalDaysLabel'
import { resolveRepresentativeReservationId } from '$lib/server/resolveOrderRepresentative'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'

import type { RentalListRow } from '../reservation/+page.server'
export type { RentalListRow }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole, session } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin  = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  // 화면 최초진입(URL에 ?status= 자체가 없음) 기본값 = '계약완료'(confirmed) — 2026-08-20.
  // '전체' 칩 클릭 시에는 +page.svelte가 status=''를 명시적으로 params에 채워 보내므로
  // url.searchParams.has('status')가 true가 되어 이 기본값으로 되돌아가지 않는다.
  const status = url.searchParams.has('status') ? (url.searchParams.get('status') ?? '') : 'confirmed'
  const search = url.searchParams.get('search') ?? ''
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

  // 예약을 가리키는 링크(?selected=)로 들어왔는데 그 예약이 이미 취소 상태라면 '취소·환불' 칩으로 전환해 연다
  // (취소된 예약은 다른 칩 목록에 없어 패널이 열리지 않던 문제). 칩 클릭 시에는 화면이 selected를 지우므로 칩 이동이 막히지 않는다.
  if (selectedId != null && !isCancelledView) {
    const { data: selRow } = await admin.from('rental_reservations').select('status').eq('id', selectedId).maybeSingle()
    if ((selRow as { status?: string } | null)?.status === 'cancelled') {
      // 결제완료 이력이 없는 취소는 예약현황 '취소' 칩에서 관리한다(Migration #714)
      const { data: payRow } = await admin.from('rental_reservations').select('payment_confirmed_at').eq('id', selectedId).maybeSingle()
      const wasPaid = (payRow as { payment_confirmed_at?: string | null } | null)?.payment_confirmed_at != null
      throw redirect(303, wasPaid
        ? `/cms/rentals?status=cancelled_refunded&selected=${selectedId}`
        : `/cms/reservation?status=cancelled&selected=${selectedId}`)
    }
  }

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:           isCancelledView ? 'cancelled' : (status || null),
    p_search:           search   || null,
    p_date_from:        null,
    p_date_to:          null,
    p_page:             page,
    p_per_page:         30,
    p_include_statuses: isCancelledView ? ['cancelled'] : RENTAL_STATUSES,
    // '취소·환불' 칩 = 결제완료 이력이 있는 취소(계약완료·결제완료 후 취소). 결제 전 취소는 예약현황 '취소' 칩(Migration #714)
    p_cancel_payment_scope: isCancelledView ? 'paid' : null,
    // 장바구니 다중 상품 = 하나의 코드품번·하나의 행(주문 단위 대표 행, Migration 618)
    p_group_by_order:   true,
  })

  if (error) console.error('[cms/rentals] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  // 총 건수·페이지 수는 취소중 행을 앞에 붙이기 "전"의 원 목록 기준으로 확정한다 — 취소중 행은
  // get_rental_list(p_reservation_id)로 1건씩 가져와 그 행의 total_count가 항상 1이라, 붙인 뒤 계산하면
  // "총 N건"과 페이지 수가 틀어진다(QA B-1).
  const totalCount = rentals[0]?.total_count ?? 0

  // 링크로 연 예약이 이 페이지(1페이지 30건)에 없으면(취소 건이 많아 다음 페이지에 있는 경우) 그 행만 따로 가져와 맨 위에 붙인다 —
  // 목록에 없으면 패널이 열리자마자 닫히므로. 총 건수·페이지 수는 영향 없음(원 목록 기준으로 이미 확정).
  if (isCancelledView && selectedId != null && !rentals.some(r => r.reservation_id === selectedId)) {
    const { data: selOne, error: selErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null,
      p_page: 1, p_per_page: 1, p_include_statuses: ['cancelled'], p_reservation_id: selectedId,
      p_group_by_order: true,
    })
    if (selErr) console.error('[cms/rentals] 링크 예약 조회 실패:', selErr.message)
    const one = ((selOne ?? []) as RentalListRow[])[0]
    if (one) rentals.unshift(one)
  }
  // 고객이 취소했고 관리자 취소확인 전인 예약("취소중") — 대여 라이프사이클 스코프(cancelled 제외)와 별개로
  // 목록 최상단에 "예약취소" 배지로 노출해 관리자가 놓치지 않게 한다(첫 페이지, 검색어 없음, 전체/계약완료 칩에서만).
  // 헤더의 [예약취소] 버튼 = 관리자 취소확인(confirm-cancel API) → 고객 마이페이지에서 "취소" 화면으로 이동.
  if (page === 1 && !search && (status === '' || status === 'confirmed')) {
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
  rentals.sort((a, b) => Number(!!b.cancel_pending) - Number(!!a.cancel_pending))
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

  return { rentals, totalCount, totalPages, status, search, page, selectedId, cmsRole, canChangeOrCancelReservation }
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
      rental_complete:     ['returned'],
    }
    const allowed = NOTIFY_ALLOWED_STATUSES[notifyType]
    if (allowed) {
      const { data: stRow } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
      const st = (stRow as { status?: string } | null)?.status
      if (!st || !allowed.includes(st)) return fail(400, { message: '이 알림은 현재 예약 단계에서 보낼 수 없습니다.' })
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
