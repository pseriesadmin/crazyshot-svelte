/**
 * rpcRetryWithFailSoftLog — Toss 취소 완료 후 DB RPC 재시도 + fail-soft 로깅 공유 헬퍼
 *
 * 사용 맥락: Toss 결제 취소 API 호출에 성공했으나 DB RPC가 실패한 경우,
 *           이미 PG에서 환불이 완료된 상황이므로 RPC를 최대 3회 재시도한다.
 *           3회 모두 실패하면 paymentKey가 있을 때 fail-soft 기록을 남긴다:
 *             1) payment_transactions.refund_failed_at/refund_failure_reason 업데이트
 *             2) 관리자 푸시 알림
 *             3) 관리자 전용 채팅 카드 삽입 (admin_only: true)
 *
 * 적용 위치 (3곳):
 *   - api/cms/reservations/[id]/payment/+server.ts PUT handler  (cancel_reservation_payment)
 *   - cms/reservation/+page.server.ts changeReservation          (revert_reservation_order_to_hold)
 *   - cms/reservation/+page.server.ts updateStatus cancelled manager  (cancel_reservation_payment)
 *
 * ⛔ 이 헬퍼를 수정할 때는 위 3곳에 모두 영향이 있으므로 반드시 변경 전 확인
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToAdmins } from '$lib/server/push'

const MAX_RPC_ATTEMPTS = 3
const RPC_RETRY_DELAY_MS = 600

export interface RpcRetryResult<T> {
  rpcResult: T | null
  failed: boolean
  failureReason?: string
}

/**
 * Toss 취소 성공 후 DB RPC를 최대 3회 재시도하고, 전부 실패 시 fail-soft 로깅을 수행한다.
 *
 * @param admin         Supabase service_role 클라이언트
 * @param rpcName       호출할 RPC 이름
 * @param rpcParams     RPC 파라미터 객체
 * @param isSuccess     RPC 결과가 성공인지 판별하는 predicate
 * @param paymentKey    결제 키 (있으면 payment_transactions fail-soft 기록 활성화)
 * @param reservationId 예약 ID (알림·채팅카드 삽입용)
 * @param contextLabel  알림 문구에 사용할 컨텍스트 설명 (예: '관리자 환불')
 */
export async function rpcRetryWithFailSoftLog<T>(options: {
  admin: SupabaseClient
  rpcName: string
  rpcParams: Record<string, unknown>
  isSuccess: (result: T | null) => boolean
  paymentKey?: string | null
  reservationId: number
  contextLabel: string
}): Promise<RpcRetryResult<T>> {
  const { admin, rpcName, rpcParams, isSuccess, paymentKey, reservationId, contextLabel } = options

  let rpcResult: T | null = null
  let lastErr: string | null = null

  for (let attempt = 0; attempt < MAX_RPC_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, RPC_RETRY_DELAY_MS))
    }
    const { data, error } = await admin.rpc(rpcName, rpcParams)
    if (error) {
      lastErr = (error as { message?: string }).message ?? String(error)
      continue
    }
    const result = data as T | null
    if (!isSuccess(result)) {
      const anyResult = result as Record<string, unknown> | null
      lastErr =
        (typeof anyResult?.error === 'string' ? anyResult.error : null) ??
        `${rpcName}: unsuccessful result`
      continue
    }
    rpcResult = result
    lastErr = null
    break
  }

  if (rpcResult !== null && lastErr === null) {
    return { rpcResult, failed: false }
  }

  const failureReason = lastErr ?? '알 수 없는 오류'

  // fail-soft 로깅은 paymentKey가 있을 때만 (Toss 취소가 먼저 완료된 경우)
  if (paymentKey) {
    // 1. DB 실패 기록 (fail-soft)
    try {
      await admin
        .from('payment_transactions')
        .update({
          refund_failed_at: new Date().toISOString(),
          refund_failure_reason: failureReason,
        })
        .eq('payment_key', paymentKey)
    } catch { /* fail-soft */ }

    // 2. 관리자 푸시 알림 (fail-soft)
    try {
      await sendPushToAdmins('payment_completed', {
        title: `${contextLabel} 실패 — 확인 필요`,
        body: `예약 #${reservationId}: Toss 취소는 완료됐으나 DB 반영에 실패했습니다. Toss 콘솔에서 직접 확인해주세요.`,
        link: `/cms/reservation?selected=${reservationId}`,
      })
    } catch { /* fail-soft */ }

    // 3. 관리자 전용 채팅 카드 (fail-soft, service-operations.md §11 공용 RPC 경유)
    try {
      const { data: rvForChat } = await admin
        .from('rental_reservations')
        .select('user_id')
        .eq('id', reservationId)
        .maybeSingle()
      const chatUserId = (rvForChat as { user_id?: string | null } | null)?.user_id
      if (chatUserId) {
        const { data: chatSessionId, error: chatSessionErr } = await admin.rpc(
          'find_or_create_general_chat_session',
          { p_user_id: chatUserId, p_reservation_id: reservationId },
        )
        if (!chatSessionErr && chatSessionId) {
          await admin.from('chat_messages').insert({
            session_id: chatSessionId,
            sender_type: 'admin',
            message_type: 'action_card',
            content: `[${contextLabel}] PG 환불 처리 실패 — 확인 필요`,
            admin_only: true,
            action_payload: {
              type: 'refund_failed',
              reservation_id: String(reservationId),
              action_url: `/cms/reservation?selected=${reservationId}`,
              button_label: '환불실패확인',
            },
          })
        }
      }
    } catch { /* fail-soft */ }
  }

  return { rpcResult: null, failed: true, failureReason }
}
