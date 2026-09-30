/**
 * 고객 예약취소 정책(canCancelReservation.ts)에 필요한 서버 조회 헬퍼.
 *  - 수령 방식별 신청 마감 규칙(rental_method_options → resolveLeadRule)
 *  - 같은 주문에 묶인 형제 예약(주문 전체가 함께 취소·환불되므로 가장 엄격한 판정을 따른다)
 * 마이페이지 목록(/account, /account/rental)과 취소 API(/api/checkout/cancel-reservation)가 공유한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveLeadRule, type LeadRule } from '$lib/utils/pickupLeadTime'
import { getCancelKind, worstCancelKind, type CancelKind } from '$lib/utils/canCancelReservation'

export interface CancelRow {
  id: string | number
  status: string
  tracking_number: string | null
  start_date: string | null
  pickup_method: string | null
}

type MethodRow = { method_key: string; is_delivery_type: boolean | null; deadline_time: string | null }

export function ruleFromMethodRow(
  row: { is_delivery_type?: boolean | null; deadline_time?: string | null } | null | undefined,
): LeadRule {
  return resolveLeadRule({ isDeliveryType: row?.is_delivery_type === true, deadlineText: row?.deadline_time ?? null })
}

/** 방식 키 → 신청 마감 규칙 (활성 방식 중 display_order가 앞선 행 우선, 없으면 기본 규칙) */
export async function loadLeadRuleMap(client: SupabaseClient, methodKeys: string[]): Promise<Map<string, LeadRule>> {
  const map = new Map<string, LeadRule>()
  const keys = [...new Set(methodKeys.filter(Boolean))]
  if (keys.length === 0) return map
  const res = await client
    .from('rental_method_options')
    .select('method_key, is_delivery_type, deadline_time')
    .in('method_key', keys)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
  for (const row of ((res as { data?: MethodRow[] | null } | null)?.data ?? [])) {
    if (!map.has(row.method_key)) map.set(row.method_key, ruleFromMethodRow(row))
  }
  return map
}

function kindOf(row: CancelRow, rules: Map<string, LeadRule>, nowMs: number): CancelKind {
  return getCancelKind({
    status: row.status,
    trackingNumber: row.tracking_number,
    startDate: row.start_date,
    rule: row.pickup_method ? rules.get(row.pickup_method) : undefined,
    nowMs,
  })
}

const ACTIVE = new Set(['hold', 'confirmed'])

/** 주문에 묶인 다른 예약(self 제외)들의 취소 판정 — 취소 API용 */
export async function loadOrderSiblingKinds(
  client: SupabaseClient,
  orderId: number,
  selfId: string | number,
  nowMs: number,
): Promise<CancelKind[]> {
  const itemsRes = await client.from('order_items').select('reservation_id').eq('order_id', orderId)
  const ids = ((itemsRes as { data?: Array<{ reservation_id: number | null }> | null } | null)?.data ?? [])
    .map(i => i.reservation_id)
    .filter((v): v is number => v != null && String(v) !== String(selfId))
  if (ids.length === 0) return []
  const resRes = await client
    .from('rental_reservations')
    .select('id, status, tracking_number, start_date, pickup_method')
    .in('id', ids)
  const rows = ((resRes as { data?: CancelRow[] | null } | null)?.data ?? []).filter(r => ACTIVE.has(r.status))
  if (rows.length === 0) return []
  const rules = await loadLeadRuleMap(client, rows.map(r => r.pickup_method ?? ''))
  return rows.map(r => kindOf(r, rules, nowMs))
}

/** 목록의 각 예약에 대한 취소 판정 (같은 주문의 형제 예약까지 반영) */
export async function loadCancelKinds(
  client: SupabaseClient,
  rows: CancelRow[],
  nowMs: number,
): Promise<Map<string, CancelKind>> {
  const result = new Map<string, CancelKind>()
  if (rows.length === 0) return result

  const ownIds = rows.map(r => r.id)
  const ownItemsRes = await client.from('order_items').select('reservation_id, order_id').in('reservation_id', ownIds)
  const ownItems = ((ownItemsRes as { data?: Array<{ reservation_id: number; order_id: number }> | null } | null)?.data ?? [])
  const orderIds = [...new Set(ownItems.map(i => i.order_id))]

  const orderOf = new Map<string, number>()
  for (const i of ownItems) orderOf.set(String(i.reservation_id), i.order_id)

  const members = new Map<number, Set<string>>() // orderId → 예약 id들
  const extra: CancelRow[] = []
  if (orderIds.length > 0) {
    const allItemsRes = await client.from('order_items').select('reservation_id, order_id').in('order_id', orderIds)
    const allItems = ((allItemsRes as { data?: Array<{ reservation_id: number; order_id: number }> | null } | null)?.data ?? [])
    const known = new Set(ownIds.map(String))
    const siblingIds: number[] = []
    for (const i of allItems) {
      if (!members.has(i.order_id)) members.set(i.order_id, new Set())
      members.get(i.order_id)?.add(String(i.reservation_id))
      if (!known.has(String(i.reservation_id))) siblingIds.push(i.reservation_id)
    }
    if (siblingIds.length > 0) {
      const sibRes = await client
        .from('rental_reservations')
        .select('id, status, tracking_number, start_date, pickup_method')
        .in('id', siblingIds)
      extra.push(...(((sibRes as { data?: CancelRow[] | null } | null)?.data ?? [])))
    }
  }

  const byId = new Map<string, CancelRow>()
  for (const r of [...rows, ...extra]) byId.set(String(r.id), r)
  const rules = await loadLeadRuleMap(client, [...byId.values()].map(r => r.pickup_method ?? ''))

  for (const row of rows) {
    const own = kindOf(row, rules, nowMs)
    // hold(신청대기)는 결제·계약 전이라 그 건만 개별 취소된다(update_reservation_status) — 형제 예약 판정을 적용하지 않는다
    // (취소 API가 hold를 형제 없이 판정하는 것과 동일하게 맞춤, QA M-2)
    if (row.status === 'hold') { result.set(String(row.id), own); continue }
    const orderId = orderOf.get(String(row.id))
    const sibKinds: CancelKind[] = []
    if (orderId != null) {
      for (const sid of members.get(orderId) ?? []) {
        if (sid === String(row.id)) continue
        const sib = byId.get(sid)
        if (sib && ACTIVE.has(sib.status)) sibKinds.push(kindOf(sib, rules, nowMs))
      }
    }
    result.set(String(row.id), worstCancelKind([own, ...sibKinds]))
  }
  return result
}

/** 이미 취소 요청 카드가 접수된 예약 id 집합 — chat_messages의 cancel_request 카드 기준(별도 상태 컬럼 없음) */
export async function loadCancelRequestedIds(
  client: SupabaseClient,
  reservationIds: Array<string | number>,
): Promise<Set<string>> {
  const out = new Set<string>()
  if (reservationIds.length === 0) return out
  const res = await client
    .from('chat_messages')
    .select('action_payload')
    .eq('message_type', 'action_card')
    .eq('action_payload->>type', 'cancel_request')
    .in('action_payload->>reservation_id', reservationIds.map(String))
  for (const row of ((res as { data?: Array<{ action_payload: { reservation_id?: string } | null }> | null } | null)?.data ?? [])) {
    const id = row.action_payload?.reservation_id
    if (id) out.add(String(id))
  }
  return out
}

/** 단일 예약의 취소 판정(형제 예약 포함) — 취소 요청 API용 */
export async function evaluateReservationCancelKind(
  client: SupabaseClient,
  reservation: CancelRow,
  orderId: number | null,
  nowMs: number,
): Promise<CancelKind> {
  const rules = await loadLeadRuleMap(client, [reservation.pickup_method ?? ''])
  const own = kindOf(reservation, rules, nowMs)
  if (own !== 'free' && own !== 'after_deadline') return own
  const siblings = orderId != null ? await loadOrderSiblingKinds(client, orderId, reservation.id, nowMs) : []
  return worstCancelKind([own, ...siblings])
}
