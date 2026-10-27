// src/lib/server/dheroOrderUnits.ts
// P3-2 (2026-10-27): isDheroBooking 헬퍼 추가 — courier_code 기반 두발히어로 여부 판별
// 두발히어로 배송 접수는 "예약코드(주문) 1건 = 배송 1건" (2026-10-27, Stephen 확정)
//
// 한 예약코드에 상품이 여러 개여도 rental_reservations 는 상품(재고 단위)별로 1행씩 있다.
// 배송 접수·반품 접수·취소는 이 행들을 한 묶음으로 다뤄야 하므로, 주문의 예약 id 목록과 접수용 상품명을 한곳에서 만든다.
// 사용처: cms/reservation updateOrderStatus·triggerDheroForTransition, /api/cms/reservations/[id]/dhero(수동 접수)·cancel·return

/**
 * courier_code 가 두발히어로 배송 접수번호인지 판별.
 * - null / undefined: courier_code 컬럼 도입 이전 예약 → 두발히어로로 간주(하위 호환)
 * - '두발히어로': 두발히어로 접수 확인
 * - 그 외 값('CJ대한통운' 등): 수동 운송장 입력(타 택배사) → 두발히어로 API 호출 불가
 */
export function isDheroBooking(courierCode: string | null | undefined): boolean {
  if (courierCode == null) return true // null | undefined = 구형 예약, 하위 호환
  return courierCode === '두발히어로'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

/**
 * 같은 주문(예약코드)에 속한 예약 id 전부(요청한 예약 포함, 오름차순).
 * 주문에 묶이지 않은 예약은 자기 자신만. 조회가 실패해도 최소한 요청한 예약은 돌려준다(fail-soft).
 */
export async function listOrderReservationIds(admin: AnySupabaseClient, reservationId: number): Promise<number[]> {
  let ids: number[] = [reservationId]
  try {
    const { data: oi } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
    const oid = (oi as { order_id?: number | null } | null)?.order_id
    if (oid != null) {
      const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', oid)
      const mapped = ((sibs ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => v != null)
      if (mapped.length > 0) ids = mapped
    }
  } catch { /* fail-soft — 최소한 요청한 예약은 처리 */ }
  if (!ids.includes(reservationId)) ids = [reservationId, ...ids]
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** 접수용 상품명 — 같은 상품은 "이름 ×수량"으로 합치고 " + "로 잇는다. 두발히어로 글자수 제한(500자)을 넘기지 않는다 */
export function joinProductNames(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  const text = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' + ')
  return text.slice(0, 500)
}

/**
 * 같은 주문에서 "같은 접수번호(tracking_number)"를 가진 예약 id 전부(요청한 예약 포함, 오름차순).
 * 취소·반품 접수처럼 접수 1건에 묶인 상품 전부를 함께 처리할 때 쓴다. 조회가 실패해도 요청한 예약은 항상 포함한다(fail-soft).
 */
export async function listSameBookReservationIds(admin: AnySupabaseClient, reservationId: number, trackingNumber: string): Promise<number[]> {
  const ids = new Set<number>([reservationId])
  try {
    const orderIds = await listOrderReservationIds(admin, reservationId)
    const { data } = await admin.from('rental_reservations').select('id, tracking_number').in('id', orderIds)
    for (const u of (data ?? []) as { id: number; tracking_number: string | null }[]) {
      if (u.tracking_number === trackingNumber) ids.add(u.id)
    }
  } catch { /* fail-soft — 요청한 예약만 처리 */ }
  return [...ids].sort((a, b) => a - b)
}
