import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CMS 예약목록·대여현황은 "주문 1건 = 목록 1행"이다(get_rental_list p_group_by_order, Migration 618).
 * 대표 행은 주문(order_items) 내 활성(취소·만료 제외) 예약 중 가장 작은 id, 활성 예약이 없으면 전체 중 가장 작은 id
 * (get_rental_list 묶음 모드의 대표 규칙과 동일 — 취소된 상품이 대표가 되어 버튼·QR이 죽은 예약에 걸리지 않게).
 * 딥링크(?selected=)가 비대표 형제 예약 id를 가리켜도 그 주문의 대표 행으로 열리도록 id를 환산한다.
 * 주문에 속하지 않은 예약이거나 조회에 실패하면 받은 id를 그대로 돌려준다(fail-soft).
 */
export async function resolveRepresentativeReservationId(
  admin: SupabaseClient,
  reservationId: number
): Promise<number> {
  try {
    const { data: own } = await admin
      .from('order_items')
      .select('order_id')
      .eq('reservation_id', reservationId)
      .maybeSingle()
    const orderId = (own as { order_id: number | null } | null)?.order_id
    if (orderId == null) return reservationId

    const { data: siblings } = await admin
      .from('order_items')
      .select('reservation_id')
      .eq('order_id', orderId)
    const ids = ((siblings ?? []) as Array<{ reservation_id: number | null }>)
      .map((r) => r.reservation_id)
      .filter((v): v is number => v != null)
    if (ids.length === 0) return reservationId

    const { data: rows } = await admin
      .from('rental_reservations')
      .select('id, status')
      .in('id', ids)
    const active = ((rows ?? []) as Array<{ id: number; status: string }>)
      .filter((r) => r.status !== 'cancelled' && r.status !== 'expired')
      .map((r) => r.id)
    return active.length > 0 ? Math.min(...active) : Math.min(...ids)
  } catch {
    return reservationId
  }
}
