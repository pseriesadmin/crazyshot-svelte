// 내정보 > 대여 카드 — 전자계약 서명 상태 조회 (서명완료 vs 서명대기)
// account/rental/+page.server.ts(모바일)와 account/+page.server.ts(PC)가 공유
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '$lib/types/database'

export interface RentalContractStatus {
  signed: boolean
  // signed=false이고 발송된 계약이 있을 때만 값이 있음 — /contract/{token} 서명화면 딥링크용
  pendingToken: string | null
}

interface RawContractSigningRow {
  token: string
  signed_at: string | null
  sent_at: string | null
}

interface RawContractRow {
  reservation_id: string | number
  contract_signings: RawContractSigningRow[] | null
}

interface OrderItemRow {
  reservation_id: string | number
  order_id: string | number | null
}

// contract.md "상태 판정" 원칙: 서명완료 여부는 반드시 contract_signings.signed_at 기준
// (contracts.signed_at은 죽은 필드, 판정에 사용 금지)
//
// 2026-08-31(CRITICAL 수정): init-contract API가 "같은 주문(order_items 경유)에 이미
// 계약이 있으면 재사용"으로 바뀌어(service-operations.md §4, 예약=주문 단위 통일),
// 계약(contracts)이 이제 주문당 정확히 1건만 존재하고 대표 예약에만 anchor된다. 이 함수가
// 예전처럼 각 reservationId 자신의 contracts.reservation_id만 조회하면, 형제 예약(같은
// 주문의 다른 상품)은 실제로 서명 완료된 계약이 있어도 영원히 "서명 안 됨"으로 잘못
// 판정된다 — 고객이 이미 서명한 계약서를 마이페이지에서 확인할 방법이 없어지는 CRITICAL
// 결함(감사로 발견). order_items를 거쳐 같은 주문의 형제 예약까지 함께 조회해 해결한다.
export async function loadRentalContractStatus(
  supabase: SupabaseClient<Database>,
  reservationIds: Array<string | number>,
): Promise<Map<string, RentalContractStatus>> {
  const statusMap = new Map<string, RentalContractStatus>()
  if (reservationIds.length === 0) return statusMap

  const inputIds = reservationIds.map(String)

  // 1. 입력 예약들이 속한 주문(order_id) 조회
  const { data: ownItemRows } = await supabase
    .from('order_items')
    .select('reservation_id, order_id')
    .in('reservation_id', reservationIds)

  const reservationToOrder = new Map<string, string>()
  const orderIds = new Set<string>()
  for (const row of (ownItemRows ?? []) as unknown as OrderItemRow[]) {
    if (row.order_id != null) {
      reservationToOrder.set(String(row.reservation_id), String(row.order_id))
      orderIds.add(String(row.order_id))
    }
  }

  // 2. 그 주문들에 묶인 형제 예약 전체 조회(입력 목록에 없는 예약이 대표일 수도 있음)
  const orderToSiblings = new Map<string, string[]>()
  if (orderIds.size > 0) {
    const { data: siblingRows } = await supabase
      .from('order_items')
      .select('reservation_id, order_id')
      .in('order_id', Array.from(orderIds))

    for (const row of (siblingRows ?? []) as unknown as OrderItemRow[]) {
      if (row.order_id == null) continue
      const key = String(row.order_id)
      const list = orderToSiblings.get(key) ?? []
      list.push(String(row.reservation_id))
      orderToSiblings.set(key, list)
    }
  }

  // 3. 계약 조회 대상 = 입력 예약 전체 + 그 주문의 형제 예약 전체(중복 제거)
  const lookupIds = new Set<string>(inputIds)
  for (const siblings of orderToSiblings.values()) {
    for (const sid of siblings) lookupIds.add(sid)
  }

  const { data } = await supabase
    .from('contracts')
    .select('reservation_id, contract_signings(token, signed_at, sent_at)')
    .in('reservation_id', Array.from(lookupIds))

  // 예약 1건에 계약이 여러 건(재발송 등)일 수 있어, 전체를 펼쳐 예약별로 재집계한다.
  const flat: Array<{ reservationId: string; token: string; signedAt: string | null; sentAt: string | null }> = []
  for (const row of (data ?? []) as unknown as RawContractRow[]) {
    const reservationId = String(row.reservation_id)
    for (const s of row.contract_signings ?? []) {
      flat.push({ reservationId, token: s.token, signedAt: s.signed_at, sentAt: s.sent_at })
    }
  }

  for (const reservationId of inputIds) {
    // 이 예약이 속한 주문의 형제 예약 목록(자기 자신 포함) — 주문에 안 묶여 있으면 자기 자신만.
    const orderId = reservationToOrder.get(reservationId)
    const candidateIds = orderId ? (orderToSiblings.get(orderId) ?? [reservationId]) : [reservationId]

    const rows = flat.filter(r => candidateIds.includes(r.reservationId))
    const signed = rows.some(r => r.signedAt !== null)
    let pendingToken: string | null = null
    if (!signed) {
      const pending = rows
        .filter(r => r.signedAt === null && r.sentAt !== null)
        .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
      pendingToken = pending[0]?.token ?? null
    }
    statusMap.set(reservationId, { signed, pendingToken })
  }

  return statusMap
}
