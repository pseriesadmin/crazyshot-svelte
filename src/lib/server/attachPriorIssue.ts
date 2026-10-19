/**
 * CS 사전 이슈 접수 표식("사전접수건")을 목록 행에 붙인다 (3단계, 2026-10-18, Migration #728).
 * 목록은 주문 1건 = 1행(대표 예약)이므로, 같은 주문의 형제 중 하나라도 has_prior_issue 이면 그 행에 표식을 붙인다.
 * 조회 실패(컬럼 없음 등)는 표식 없이 진행한다(fail-soft — 목록 자체는 항상 보인다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function attachPriorIssue<T extends { reservation_id: number; prior_issue?: boolean }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<void> {
  const ids = rows.map((r) => r.reservation_id)
  if (ids.length === 0) return

  const { data: ownItems, error: e1 } = await admin.from('order_items').select('order_id, reservation_id').in('reservation_id', ids)
  if (e1) {
    console.error('[attachPriorIssue] 주문 조회 실패:', e1.message)
    return
  }
  const orderOf = new Map<number, number>()
  for (const o of (ownItems ?? []) as { order_id: number | null; reservation_id: number | null }[]) {
    if (o.order_id != null && o.reservation_id != null) orderOf.set(o.reservation_id, o.order_id)
  }
  const orderIds = [...new Set(orderOf.values())]

  const siblingsByOrder = new Map<number, number[]>()
  if (orderIds.length > 0) {
    const { data: sibs, error: e2 } = await admin.from('order_items').select('order_id, reservation_id').in('order_id', orderIds)
    if (e2) {
      console.error('[attachPriorIssue] 형제 조회 실패:', e2.message)
      return
    }
    for (const s of (sibs ?? []) as { order_id: number | null; reservation_id: number | null }[]) {
      if (s.order_id == null || s.reservation_id == null) continue
      const list = siblingsByOrder.get(s.order_id) ?? []
      list.push(s.reservation_id)
      siblingsByOrder.set(s.order_id, list)
    }
  }

  const allIds = new Set<number>(ids)
  for (const list of siblingsByOrder.values()) for (const id of list) allIds.add(id)

  const { data: flagged, error: e3 } = await admin
    .from('rental_reservations')
    .select('id')
    .in('id', [...allIds])
    .eq('has_prior_issue', true)
  if (e3) {
    console.error('[attachPriorIssue] 사전접수 조회 실패:', e3.message)
    return
  }
  const flaggedSet = new Set(((flagged ?? []) as { id: number }[]).map((r) => r.id))
  if (flaggedSet.size === 0) return

  for (const r of rows) {
    const orderId = orderOf.get(r.reservation_id)
    const group = orderId != null ? (siblingsByOrder.get(orderId) ?? [r.reservation_id]) : [r.reservation_id]
    if (flaggedSet.has(r.reservation_id) || group.some((id) => flaggedSet.has(id))) r.prior_issue = true
  }
}
