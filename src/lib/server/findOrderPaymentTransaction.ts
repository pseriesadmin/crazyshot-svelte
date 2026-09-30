import type { SupabaseClient } from '@supabase/supabase-js'

// 2026-08-31(CRITICAL 수정): confirm_order_payment_and_update_reservations(Migration 378)는
// 주문당 payment_transactions 1행만 대표 예약에 연결한다. 이 예약(params.id) 자신이 대표가
// 아닌 형제 예약(같은 주문의 다른 상품)일 수 있으므로, 직접 매칭이 없으면 order_items 경유로
// 같은 주문의 결제 행을 찾는다 — cancel_reservation_payment RPC(Migration 379/384)의
// 1a/1b 조회 패턴과 동일. 이게 없으면 형제 예약의 "결제정보" 탭이 항상 "결제 정보가
// 없습니다"로 뜨고 환불 버튼도 영구히 비활성화된다(CMS 감사로 발견).
export async function findOrderPaymentTransaction(
  admin: SupabaseClient,
  reservationId: number,
) {
  const selectCols = `
    order_id,
    payment_key,
    payment_method,
    total_amount,
    paid_amount,
    point_amount,
    coupon_discount,
    confirmed_at,
    toss_response,
    status,
    refund_failed_at,
    refund_failure_reason,
    pg_cancelled_at
  `

  const { data: direct, error: directErr } = await admin
    .from('payment_transactions')
    .select(selectCols)
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directErr) return { data: null, error: directErr }
  if (direct) return { data: direct, error: null }

  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id
  if (orderId == null) return { data: null, error: null }

  const { data: siblingItems } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', orderId)
  const siblingIds = ((siblingItems ?? []) as { reservation_id: number | null }[])
    .map((r) => r.reservation_id)
    .filter((v): v is number => v != null)
  if (siblingIds.length === 0) return { data: null, error: null }

  return admin
    .from('payment_transactions')
    .select(selectCols)
    .in('reservation_id', siblingIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
}
