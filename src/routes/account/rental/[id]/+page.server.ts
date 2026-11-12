// GET /account/rental/[id] — hold 예약 상세 확인 화면 (본인 소유 예약만)
// 소유권 검증 패턴: contract/+page.server.ts와 동일 — 없으면 /account/rental로 redirect
import { redirect } from '@sveltejs/kit'
import { isRealMemberSession } from '$lib/utils/authGuard'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'
import type { DheroStageInfo } from '$lib/utils/dheroJourneyStage'
import { dheroStageForReservation } from '$lib/server/dheroStageForReservation'
import type { PageServerLoad } from './$types'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export interface ReservationDetail {
  id:                 string
  status:             string
  reservation_code:   string
  start_date:         string | null
  end_date:           string | null
  pickup_method:      string | null
  return_method:      string | null
  pickup_time:        string | null
  return_time:        string | null
  product_name:       string | null
  product_category:   string | null
  has_signed_contract: boolean
  /** 두발히어로 배송 5단계 진행 정보 — RentalJourneyStepper dheroStage prop에 전달 */
  dheroStage:         DheroStageInfo | null
}

export interface ReservationOption {
  id:           string
  option_name:  string
  qty:          number
  unit_price:   number
}

export interface ReservationAmount {
  rental_fee:   number
  options_fee:  number
  deposit:      number
}

type EditStateRpc = (fn: string, args: { p_reservation_id: number }) => Promise<{ data: unknown; error: unknown }>

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const { session } = await locals.safeGetSession()
  // 익명(채팅 게스트) 세션은 가입 전 계정이라 로그인으로 보낸다(빈 화면 방지, 2026-10-27)
  if (!isRealMemberSession(session)) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  // 소유권 확인은 RLS 클라이언트로 — user_id 불일치 시 조회 자체가 안 됨
  const { data: raw } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, pickup_method, return_method, pickup_time, return_time, tracking_number, courier_code, dhero_status_code, dhero_meta, dhero_return_book_id, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!raw) {
    // 없거나 타인 소유 → /account/rental로 조용히 redirect (존재 여부 비노출)
    throw redirect(303, '/account/rental')
  }

  const reservationId = Number(params.id)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 자식 재고의 이름·분류는 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-B)
  await applyParentFieldsToRowProducts([raw], ['name', 'category'], admin)

  // 옵션상품 조회
  const { data: optionRows } = await admin
    .from('reservation_options')
    .select('id, option_name, qty, unit_price')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  // 금액 서버 정본 — rental-fee-policy.md: 클라이언트 재계산 금지, 반드시 이 RPC 경유
  const { data: amountRows } = await admin.rpc('compute_reservation_line_amount', {
    p_reservation_id: reservationId,
  })

  const typedRaw = raw as unknown as {
    id: string | number
    status: string
    reservation_code: string
    start_date: string | null
    end_date: string | null
    pickup_method: string | null
    return_method: string | null
    pickup_time: string | null
    return_time: string | null
    tracking_number: string | null
    courier_code: string | null
    dhero_status_code: number | null
    dhero_meta: { bookId?: unknown; canceledAt?: unknown; accidentAt?: unknown } | null
    dhero_return_book_id: string | null
    products: { name: string; category: string } | null
  }

  // 계약 상태 — 공용 헬퍼 재사용 (loadRentalContractStatus는 RLS 클라이언트를 기대)
  const contractStatus = await loadRentalContractStatus(locals.supabase, [typedRaw.id])
  const cs = contractStatus.get(String(typedRaw.id))

  const amountRow = Array.isArray(amountRows) && amountRows.length > 0
    ? (amountRows[0] as { rental_fee: number; options_fee: number; deposit: number })
    : null

  const reservation: ReservationDetail = {
    id:                  String(typedRaw.id),
    status:              typedRaw.status,
    reservation_code:    typedRaw.reservation_code,
    start_date:          typedRaw.start_date,
    end_date:            typedRaw.end_date,
    pickup_method:       typedRaw.pickup_method,
    return_method:       typedRaw.return_method,
    pickup_time:         typedRaw.pickup_time,
    return_time:         typedRaw.return_time,
    product_name:        typedRaw.products?.name ?? null,
    product_category:    typedRaw.products?.category ?? null,
    has_signed_contract: cs?.signed ?? false,
    dheroStage: dheroStageForReservation({
      id:                String(typedRaw.id),
      trackingNumber:    typedRaw.tracking_number,
      courierCode:       typedRaw.courier_code,
      dheroStatusCode:   typedRaw.dhero_status_code,
      dheroMeta:         typedRaw.dhero_meta,
      dheroReturnBookId: typedRaw.dhero_return_book_id,
      cardStatus:        typedRaw.status,
    }),
  }

  const options: ReservationOption[] = (optionRows ?? []).map((o: Record<string, unknown>) => ({
    id:          String(o.id),
    option_name: o.option_name as string,
    qty:         o.qty as number,
    unit_price:  o.unit_price as number,
  }))

  const amount: ReservationAmount | null = amountRow
    ? {
        rental_fee:  Number(amountRow.rental_fee),
        options_fee: Number(amountRow.options_fee),
        deposit:     Number(amountRow.deposit),
      }
    : null

  // 예약정보 수정 버튼 — 신청대기 예약만 DB 판정(get_reservation_edit_state)으로 확인하고, 장바구니에는 같은 주문의 대표(최소 신청대기) 예약 id 를 넘긴다
  let canEdit = false
  let editTargetId: string | null = null
  if (typedRaw.status === 'hold') {
    try {
      const { data: own } = await locals.supabase.from('order_items').select('order_id').eq('reservation_id', reservationId).limit(1)
      const orderId = (own as Array<{ order_id: number }> | null)?.[0]?.order_id
      let targetId = reservationId
      if (typeof orderId === 'number') {
        const { data: sibs } = await locals.supabase.from('order_items').select('reservation_id').eq('order_id', orderId)
        const sibIds = ((sibs ?? []) as Array<{ reservation_id: number }>).map(s => s.reservation_id)
        if (sibIds.length > 0) {
          const { data: holds } = await locals.supabase.from('rental_reservations').select('id').in('id', sibIds).eq('status', 'hold').eq('user_id', session.user.id)
          const holdIds = ((holds ?? []) as Array<{ id: number }>).map(h => h.id)
          if (holdIds.length > 0) targetId = Math.min(...holdIds)
        }
      }
      const { data: state, error: stateError } = await (locals.supabase.rpc as unknown as EditStateRpc)('get_reservation_edit_state', { p_reservation_id: targetId })
      canEdit = !stateError && typeof state === 'object' && state !== null && (state as { can_edit?: unknown }).can_edit === true
      if (canEdit) editTargetId = String(targetId)
    } catch {
      canEdit = false
    }
  }

  return { reservation, options, amount, canEdit, editTargetId }
}
