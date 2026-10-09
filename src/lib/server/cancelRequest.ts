/**
 * submitCancelRequest — 고객의 "서명+결제 후(계약완료) 취소"를 요청으로 접수 (2026-10-09, Stephen 확정)
 *
 * 마감 전·후 구분 없이 항상 같은 경로: 예약·결제는 바꾸지 않고
 *   ① 같은 주문의 계약완료 예약 전체에 취소 요청 표식(cancel_requested_at, Migration 687)
 *   ② 고객 채팅 세션에 고객 발신 'cancel_request' 카드(고객·관리자 양쪽 노출)
 *   ③ 관리자 푸시(fail-soft)
 * 환불은 관리자가 CMS에서 [예약취소]를 실행할 때 기존 경로로 처리된다.
 * ⛔ 소유권·취소가능 구간 검증은 호출부 책임.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToAdmins } from '$lib/server/push'

export interface CancelRequestReservation {
  id: number
  reservation_code: string | null
  productName: string | null
  start_date: string | null
  end_date: string | null
}

export type CancelRequestResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; error: string }

/** 같은 주문의 계약완료 예약 전체에 취소 요청 표식 기록 — fail-soft(카드가 이미 접수된 뒤라 실패해도 접수는 유지, 로그만 남김) */
async function markCancelRequested(admin: SupabaseClient, reservationId: number, orderId: number | null): Promise<void> {
  try {
    let ids: number[] = [reservationId]
    if (orderId != null) {
      const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
      const sibIds = ((sibs ?? []) as Array<{ reservation_id: number | null }>)
        .map((r) => r.reservation_id)
        .filter((v): v is number => v != null)
      if (sibIds.length > 0) ids = [...new Set([reservationId, ...sibIds])]
    }
    const { error } = await admin.rpc('request_customer_cancel', { p_reservation_ids: ids })
    if (error) console.error('[cancel-request] 표식 기록 실패:', error.message)
  } catch (e) {
    console.error('[cancel-request] 표식 기록 실패:', e instanceof Error ? e.message : e)
  }
}

export async function submitCancelRequest(
  admin: SupabaseClient,
  userId: string,
  reservation: CancelRequestReservation,
  orderId: number | null,
): Promise<CancelRequestResult> {
  const reservationId = reservation.id

  // ─── 중복 접수 방지 (표식 또는 기존 카드) ──────────────────────────────
  const { data: existing } = await admin
    .from('chat_messages')
    .select('id')
    .eq('message_type', 'action_card')
    .eq('action_payload->>type', 'cancel_request')
    .eq('action_payload->>reservation_id', String(reservationId))
    .limit(1)
  if (Array.isArray(existing) && existing.length > 0) {
    // 이전 접수에서 표식 기록이 실패했을 수 있어 멱등 재기록(이미 있으면 0건)
    await markCancelRequested(admin, reservationId, orderId)
    return { ok: true, duplicate: true }
  }

  // ─── 채팅 세션 확보(공유 RPC — pending/closed면 open으로 승격) ───────────
  const { data: chatSessionId, error: sessionErr } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id: userId,
    p_reservation_id: reservationId,
  })
  if (sessionErr || !chatSessionId) {
    console.error('[cancel-request] find_or_create_general_chat_session 실패:', sessionErr?.message)
    return { ok: false, error: '취소 요청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }
  }

  const productName = reservation.productName ?? '예약 상품'
  const period = reservation.start_date && reservation.end_date
    ? `${reservation.start_date.slice(0, 10)} ~ ${reservation.end_date.slice(0, 10)}`
    : undefined
  const cmsLink = `/cms/rentals?status=&selected=${reservationId}`

  const { error: insertErr } = await admin.from('chat_messages').insert({
    session_id: chatSessionId,
    sender_type: 'user',
    message_type: 'action_card',
    content: `[취소 요청] ${productName} 예약의 취소를 요청했습니다.`,
    action_payload: {
      type: 'cancel_request',
      reservation_id: String(reservationId),
      reservation_no: reservation.reservation_code ?? undefined,
      product_name: productName,
      rental_period: period,
      action_url: cmsLink,
      button_label: '취소요청 확인',
    },
  })
  if (insertErr) {
    console.error('[cancel-request] chat_messages 삽입 실패:', insertErr.message)
    return { ok: false, error: '취소 요청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }
  }

  await markCancelRequested(admin, reservationId, orderId)

  // ─── 관리자 푸시 (fail-soft) ───────────────────────────────────────────
  try {
    await sendPushToAdmins('urgent_chat_message', {
      title: '예약 취소 요청이 접수됐어요',
      body: `${reservation.reservation_code ? `${reservation.reservation_code} ` : ''}${productName} — 상담 세션에서 확인해주세요.`,
      link: cmsLink,
    })
  } catch {
    // 푸시 실패는 무시
  }

  return { ok: true }
}
