import type { SupabaseClient } from '@supabase/supabase-js'

/** 장바구니 '예약정보 수정'(/cart?edit=<예약 id>) 로더 보조 — 판정은 DB(get_reservation_edit_state)만 쓴다(정본). */

export type ParsedEditParam = { present: false } | { present: true; id: number | null }

/** ?edit= 값 해석 — 없으면 수정 모드 아님, 있는데 양의 정수가 아니면 id 없음(거절 대상) */
export function parseEditParam(raw: string | null): ParsedEditParam {
  if (raw === null) return { present: false }
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return { present: true, id: null }
  const n = Number(raw)
  return n <= 2147483647 ? { present: true, id: n } : { present: true, id: null }
}

/** 수정 대상 예약 1건의 저장된 수령·반납 정보 — 장바구니 통합 폼 미리채움·변경 여부 비교의 기준(공동현관 출입번호는 고객 화면에 노출하지 않아 제외) */
export interface EditReservationDetail {
  pickupAddressRoad: string | null
  pickupAddressDetail: string | null
  pickupPostalCode: string | null
  returnAddressRoad: string | null
  returnAddressDetail: string | null
  returnPostalCode: string | null
  pickupRequestNote: string | null
  returnRequestNote: string | null
  pickupPointId: string | null
  returnPointId: string | null
}

export interface CartEditContext {
  ok: true
  editReservationId: number
  editOrderId: number
  /** 취소되지 않은, 같은 주문 소속 예약 id(문자열 — 장바구니 reservationIds 와 같은 형식) */
  editOrderReservationIds: string[]
  initialPoints: number
  initialCouponIds: string[]
  /** 취소되지 않은 대상 주문 예약 id(문자열) → 저장된 수령·반납 정보 */
  reservationDetails: Record<string, EditReservationDetail>
}
export interface CartEditDenied {
  ok: false
  reason: string
}

const KNOWN_REASONS = new Set([
  'SIGNED', 'PAID', 'CANCEL_REQUESTED', 'EXPIRED', 'DIRECT_PAY', 'NOT_HOLD',
  'NOT_OWNER', 'UNAUTHENTICATED', 'ERROR', 'NOT_SUBMITTED', 'STALE', 'BAD_REQUEST',
])
const safeReason = (r: unknown): string => (typeof r === 'string' && KNOWN_REASONS.has(r) ? r : 'ERROR')

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

interface DetailColumns {
  pickup_address_road?: string | null
  pickup_address_detail?: string | null
  pickup_postal_code?: string | null
  return_address_road?: string | null
  return_address_detail?: string | null
  return_postal_code?: string | null
  pickup_request_note?: string | null
  return_request_note?: string | null
  pickup_point_id?: string | null
  return_point_id?: string | null
}

type RpcCallable = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>

/**
 * 수정 가능 여부(DB 판정) + 대상 주문의 예약·쿠폰·포인트 조회.
 * 조회 오류·이상 응답은 전부 fail-closed. DB 가 NOT_OWNER 를 주지만, 대상 예약·형제·주문의 소유자를 여기서도 한 번 더 확인한다.
 */
export async function loadCartEditContext(
  supabase: SupabaseClient,
  userId: string,
  reservationId: number,
): Promise<CartEditContext | CartEditDenied> {
  try {
    const { data: state, error: stateError } = await (supabase.rpc as unknown as RpcCallable)('get_reservation_edit_state', { p_reservation_id: reservationId })
    if (stateError || !isObj(state)) return { ok: false, reason: 'ERROR' }
    if (state.can_edit !== true) return { ok: false, reason: safeReason(state.reason) }

    const { data: own, error: ownErr } = await supabase.from('order_items').select('order_id').eq('reservation_id', reservationId).limit(1)
    if (ownErr) return { ok: false, reason: 'ERROR' }
    const orderId = (own as Array<{ order_id: number }> | null)?.[0]?.order_id
    if (typeof orderId !== 'number') return { ok: false, reason: 'NOT_SUBMITTED' }

    const { data: items, error: itemsErr } = await supabase.from('order_items').select('reservation_id, order_id').eq('order_id', orderId)
    if (itemsErr) return { ok: false, reason: 'ERROR' }
    const siblingIds = [...new Set(((items ?? []) as Array<{ reservation_id: number }>).map((r) => r.reservation_id))]
    if (!siblingIds.includes(reservationId)) siblingIds.push(reservationId)

    const { data: rows, error: rowsErr } = await supabase
      .from('rental_reservations')
      .select('id, user_id, status, pickup_address_road, pickup_address_detail, pickup_postal_code, return_address_road, return_address_detail, return_postal_code, pickup_request_note, return_request_note, pickup_point_id, return_point_id')
      .in('id', siblingIds)
    if (rowsErr) return { ok: false, reason: 'ERROR' }
    const reservations = (rows ?? []) as unknown as Array<DetailColumns & { id: number; user_id: string; status: string }>
    if (reservations.some((r) => r.user_id !== userId)) return { ok: false, reason: 'NOT_OWNER' }
    const live = reservations.filter((r) => r.status !== 'cancelled').map((r) => r.id).sort((a, b) => a - b)
    if (!live.includes(reservationId)) return { ok: false, reason: 'STALE' }

    const { data: order, error: orderErr } = await supabase.from('orders').select('user_id, selected_points').eq('id', orderId).maybeSingle()
    if (orderErr || !order) return { ok: false, reason: 'ERROR' }
    const orderRow = order as { user_id: string; selected_points: number | null }
    if (orderRow.user_id !== userId) return { ok: false, reason: 'NOT_OWNER' }

    const { data: coupons, error: couponErr } = await supabase.from('order_coupons').select('user_coupon_id').eq('order_id', orderId)
    if (couponErr) return { ok: false, reason: 'ERROR' }

    const reservationDetails: Record<string, EditReservationDetail> = {}
    for (const r of reservations) {
      if (r.status === 'cancelled') continue
      reservationDetails[String(r.id)] = {
        pickupAddressRoad: r.pickup_address_road ?? null,
        pickupAddressDetail: r.pickup_address_detail ?? null,
        pickupPostalCode: r.pickup_postal_code ?? null,
        returnAddressRoad: r.return_address_road ?? null,
        returnAddressDetail: r.return_address_detail ?? null,
        returnPostalCode: r.return_postal_code ?? null,
        pickupRequestNote: r.pickup_request_note ?? null,
        returnRequestNote: r.return_request_note ?? null,
        pickupPointId: r.pickup_point_id ?? null,
        returnPointId: r.return_point_id ?? null,
      }
    }

    return {
      ok: true,
      reservationDetails,
      editReservationId: reservationId,
      editOrderId: orderId,
      editOrderReservationIds: live.map(String),
      initialPoints: typeof orderRow.selected_points === 'number' && orderRow.selected_points > 0 ? orderRow.selected_points : 0,
      initialCouponIds: ((coupons ?? []) as Array<{ user_coupon_id: string }>).map((c) => c.user_coupon_id),
    }
  } catch {
    return { ok: false, reason: 'ERROR' }
  }
}

/**
 * '이미 제출된(주문에 묶인) 예약은 장바구니에서 제외' 기존 필터 — 수정 대상 주문의 예약만 면제한다.
 * exemptIds 를 생략하면 기존 동작과 완전히 같다.
 */
export function excludeSubmittedReservations<T extends { id: number | string }>(
  rows: T[],
  submittedIds: ReadonlySet<string>,
  exemptIds: ReadonlySet<string> = new Set(),
): T[] {
  return rows.filter((r) => {
    const id = String(r.id)
    return !submittedIds.has(id) || exemptIds.has(id)
  })
}

export function editRedirectLocation(reason: string): string {
  return `/account/rental?editError=${encodeURIComponent(safeReason(reason))}`
}
