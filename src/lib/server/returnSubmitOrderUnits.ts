/**
 * 고객 반납 제출 — 주문 단위, 상품(예약)별 기록 필수 (2026-11-12, Stephen 지시)
 *
 * 한 주문(order_items.order_id)에 상품이 여러 개면 모든 상품이 각각 사진·체크리스트(방식별 요건 그대로)를 등록해야 제출된다.
 * 순수 검증 함수(validateOrderReturnSubmit)와 대상 조회(loadOrderReturnUnits)를 둔다. 저장·상태 전환은 API 라우트가 한다.
 */
import { RETURN_SUBMIT_STATUSES, resolveReturnSubmitMethod, validateReturnSubmit, type ReturnSubmitInput } from '$lib/server/returnSubmission'
import { RETURN_CHECKLIST_ITEMS, RETURN_MEDIA_ITEMS, type ReturnSubmitMethod } from '$lib/utils/returnNotice'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any }

/** 등록이 필요한 상품(예약) 1건 */
export interface OrderReturnUnit {
  id: number
  method: ReturnSubmitMethod
  status: string
}

export interface OrderReturnUnitDetail extends OrderReturnUnit {
  reservation_code: string | null
  start_date: string | null
  end_date: string | null
  return_time: string | null
  return_method: string | null
}

export type OrderReturnValidation =
  | { ok: true; value: { id: number; method: ReturnSubmitMethod; input: ReturnSubmitInput }[] }
  | { ok: false; error: string }

/**
 * 제출 본문 검증 — { units: [{ reservation_id, checklist, media, locker_number, locker_password }], feedback, rating }.
 * ① 등록 대상 상품(units 인자)과 본문의 상품이 정확히 같아야 한다(빠짐·중복·낯선 id 거절)
 * ② 상품마다 자기 반납 방식의 요건(validateReturnSubmit)을 그대로 집행한다
 * ③ 이용 평가(feedback·rating)는 주문 전체에 1번 — 첫 상품의 기록에만 붙는다
 * 상품이 1개일 때는 옛 형식(units 없이 평평한 본문)도 받는다.
 */
export function validateOrderReturnSubmit(
  targets: OrderReturnUnit[],
  body: unknown,
  checklistItems: { key: string }[] = RETURN_CHECKLIST_ITEMS,
  courierPhotoItems: { key: string }[] = RETURN_MEDIA_ITEMS.courier,
): OrderReturnValidation {
  if (targets.length === 0) return { ok: false, error: '등록할 반납 상품이 없어요.' }
  const b = (body ?? {}) as Record<string, unknown>

  let rawUnits: Record<string, unknown>[]
  if (Array.isArray(b.units)) {
    rawUnits = b.units.map((u) => ((u ?? {}) as Record<string, unknown>))
  } else if (targets.length === 1) {
    rawUnits = [{ ...b, reservation_id: targets[0].id }]
  } else {
    return { ok: false, error: '모든 상품의 반납 정보를 등록해 주세요.' }
  }

  const byId = new Map<number, Record<string, unknown>>()
  for (const u of rawUnits) {
    const id = typeof u.reservation_id === 'number' ? u.reservation_id : Number.NaN
    if (!Number.isInteger(id)) return { ok: false, error: '상품 정보가 올바르지 않아요.' }
    if (byId.has(id)) return { ok: false, error: '같은 상품이 두 번 들어 있어요.' }
    byId.set(id, u)
  }
  const targetIds = new Set(targets.map((t) => t.id))
  for (const id of byId.keys()) {
    if (!targetIds.has(id)) return { ok: false, error: '등록 대상이 아닌 상품이 들어 있어요.' }
  }
  if (targets.some((t) => !byId.has(t.id))) return { ok: false, error: '모든 상품의 반납 정보를 등록해 주세요.' }

  const ordered = [...targets].sort((a, c) => a.id - c.id)
  const out: { id: number; method: ReturnSubmitMethod; input: ReturnSubmitInput }[] = []
  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i]
    const unitBody: Record<string, unknown> = byId.get(t.id) ?? {}
    // 이용 평가는 첫 상품 기록에만 — 나머지는 비운다
    const merged =
      i === 0
        ? { ...unitBody, feedback: b.feedback ?? unitBody.feedback, rating: b.rating ?? unitBody.rating }
        : { ...unitBody, feedback: undefined, rating: undefined }
    const parsed = validateReturnSubmit(t.method, t.id, merged, checklistItems, courierPhotoItems)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    out.push({ id: t.id, method: t.method, input: parsed.value })
  }
  return { ok: true, value: out }
}

/**
 * 한 주문에서 지금 등록이 필요한 상품(예약) 목록 — 본인 예약·대여중/반납요청·사진 등록 대상 방식·아직 기록(고객 제출·관리자 대리 등록)이 없는 것만.
 * 주문 연결이 없으면 요청한 예약 1건만 본다. id 오름차순.
 */
export async function loadOrderReturnUnits(admin: AnyClient, reservationId: number, userId: string): Promise<OrderReturnUnitDetail[]> {
  let ids: number[] = [reservationId]
  const { data: oi } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (oi as { order_id?: number | null } | null)?.order_id
  if (orderId != null) {
    const { data: items } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
    const mapped = ((items ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => typeof v === 'number')
    if (mapped.length > 0) ids = [...new Set([...mapped, reservationId])]
  }

  const { data: rows } = await admin
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, return_time, return_method')
    .in('id', ids)
    .eq('user_id', userId)
  const candidates = ((rows ?? []) as { id: number; status: string; reservation_code: string | null; start_date: string | null; end_date: string | null; return_time: string | null; return_method: string | null }[]).filter(
    (r) => RETURN_SUBMIT_STATUSES.has(r.status) && resolveReturnSubmitMethod(r.return_method) !== null,
  )
  if (candidates.length === 0) return []

  // 이미 기록이 있는 상품은 제외 — 고객 제출뿐 아니라 관리자 대리 등록도 기록이다(누가 등록했든 같다, sp3 MINOR)
  const candidateIds = candidates.map((c) => c.id)
  const { data: subs } = await admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', candidateIds)
  const { data: entries } = await admin.from('reservation_return_admin_entries').select('reservation_id').in('reservation_id', candidateIds)
  const done = new Set([
    ...((subs ?? []) as { reservation_id: number }[]).map((s) => s.reservation_id),
    ...((entries ?? []) as { reservation_id: number }[]).map((e) => e.reservation_id),
  ])

  return candidates
    .filter((c) => !done.has(c.id))
    .sort((a, c) => a.id - c.id)
    .map((c) => ({
      id: c.id,
      status: c.status,
      method: resolveReturnSubmitMethod(c.return_method) as ReturnSubmitMethod,
      reservation_code: c.reservation_code,
      start_date: c.start_date,
      end_date: c.end_date,
      return_time: c.return_time,
      return_method: c.return_method,
    }))
}

/**
 * 같은 주문의 상품 중 이미 이용 평가(점수·글)가 저장된 제출이 있는지 — 중간 실패 후 재제출 때 평가가 새 첫 상품에 다시 붙어 두 번 쌓이는 것을 막는다.
 * 주문 연결이 없으면 요청한 예약 1건만 본다. 조회 실패는 false(평가를 새로 받는 쪽으로 — 평가는 선택 항목이라 유실이 중복보다 낫다).
 */
export async function orderHasReturnFeedback(admin: AnyClient, reservationId: number): Promise<boolean> {
  try {
    let ids: number[] = [reservationId]
    const { data: oi } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
    const orderId = (oi as { order_id?: number | null } | null)?.order_id
    if (orderId != null) {
      const { data: items } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
      const mapped = ((items ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => typeof v === 'number')
      if (mapped.length > 0) ids = [...new Set([...mapped, reservationId])]
    }
    const { data: subs } = await admin.from('reservation_return_submissions').select('customer_feedback, customer_rating').in('reservation_id', ids)
    return ((subs ?? []) as { customer_feedback: string | null; customer_rating: number | null }[]).some((s) => s.customer_feedback != null || s.customer_rating != null)
  } catch {
    return false
  }
}
