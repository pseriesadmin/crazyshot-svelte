import type { SupabaseClient } from '@supabase/supabase-js'

// 2026-08-31(CRITICAL 수정): confirm_order_payment_and_update_reservations(Migration 378)는
// 주문당 payment_transactions 1행만 대표 예약에 연결한다. 이 예약(params.id) 자신이 대표가
// 아닌 형제 예약(같은 주문의 다른 상품)일 수 있으므로, 직접 매칭이 없으면 order_items 경유로
// 같은 주문의 결제 행을 찾는다 — cancel_reservation_payment RPC(Migration 379/384)의
// 1a/1b 조회 패턴과 동일. 이게 없으면 형제 예약의 "결제정보" 탭이 항상 "결제 정보가
// 없습니다"로 뜨고 환불 버튼도 영구히 비활성화된다(CMS 감사로 발견).
// 고객용 영수증·취소내역은 결제 재시도로 생긴 실패·대기 행이 아니라 완료·취소된 결제 행을 봐야 한다(settledOnly) —
// 기본값(false)은 기존 동작(가장 최신 행)이라 CMS 소비처는 영향이 없다.
const SETTLED_STATUSES = ['done', 'cancelled', 'partial_cancelled']

export async function findOrderPaymentTransaction(
  admin: SupabaseClient,
  reservationId: number,
  opts: { settledOnly?: boolean } = {},
) {
  const selectCols = `
    order_id,
    user_id,
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
    pg_cancelled_at,
    cancelled_at,
    cancel_reason
  `

  let directQuery = admin
    .from('payment_transactions')
    .select(selectCols)
    .eq('reservation_id', reservationId)
  if (opts.settledOnly) directQuery = directQuery.in('status', SETTLED_STATUSES)
  const { data: direct, error: directErr } = await directQuery
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

  let siblingQuery = admin
    .from('payment_transactions')
    .select(selectCols)
    .in('reservation_id', siblingIds)
  if (opts.settledOnly) siblingQuery = siblingQuery.in('status', SETTLED_STATUSES)
  return siblingQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
}
