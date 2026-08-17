import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 예약 승인(approveReservation) 직후 채팅 알림을 어떤 방식으로 보낼지 판단한다.
 * service-operations.md §4 정책: 같은 주문(order_items)으로 묶인 다중상품 예약은 상품별로
 * 각각 "승인되었습니다" 카드를 개별 발송하지 않고, 주문 전체가 승인 완료된 시점에 통합
 * 카드 1건(send_rental_chat_notification_batch)으로 안내한다. CMS 관리자 승인은 상품(예약)
 * 단위로 한 건씩 이뤄지므로, 이 함수는 "이번 승인이 그 주문의 마지막 승인인지"를 판단해
 * single(기존 단건 알림) / batch(통합 알림, 이번 건이 마지막) / hold(알림 보류, 아직 다른
 * 상품이 미승인) 셋 중 하나로 알려준다.
 */
export type ApprovalNotifyPlan =
  | { mode: 'single' }
  | { mode: 'batch'; reservationIds: number[] }
  | { mode: 'hold' }

type OrderItemRow = { reservation_id: number | null }
type ReservationStatusRow = { id: number; status: string }

export async function resolveApprovalNotifyPlan(
  admin: SupabaseClient,
  reservationId: number
): Promise<ApprovalNotifyPlan> {
  const { data: ownItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  const orderId = (ownItem as { order_id: number | null } | null)?.order_id
  if (!orderId) return { mode: 'single' }

  const { data: orderItems } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', orderId)

  const siblingIds = ((orderItems ?? []) as OrderItemRow[])
    .map((r) => r.reservation_id)
    .filter((v): v is number => v != null)

  if (siblingIds.length <= 1) return { mode: 'single' }

  const { data: rows } = await admin
    .from('rental_reservations')
    .select('id, status')
    .in('id', siblingIds)

  // 취소·만료된 형제 상품은 영구히 confirmed가 될 수 없으므로 제외 — 그 1건 때문에 나머지
  // 상품의 통합 알림이 영영 보류되는 것을 방지한다(HOLD 30분 자동만료 도입 후 만료도
  // 취소와 동일한 영구 종결 상태이므로 같은 예외 처리 필요 — reservation-rental-
  // execution.md QA 발견, Migration 285와 상호작용해 실사고로 이어질 수 있었음).
  const relevant = ((rows ?? []) as ReservationStatusRow[]).filter(
    (r) => r.status !== 'cancelled' && r.status !== 'expired'
  )
  const allConfirmed = relevant.length > 0 && relevant.every((r) => r.status === 'confirmed')

  if (!allConfirmed) return { mode: 'hold' }

  return { mode: 'batch', reservationIds: relevant.map((r) => r.id) }
}
