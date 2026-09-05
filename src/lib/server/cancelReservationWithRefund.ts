/**
 * cancelReservationWithRefund — 고객 셀프 예약신청취소 (Toss 환불 + RPC)
 *
 * CMS 엔드포인트(api/cms/reservations/[id]/payment/+server.ts PUT)와 동일한 로직을
 * 고객 주도 취소(cancel-reservation endpoint)에서 재사용하기 위해 추출한 공용 헬퍼.
 *
 * ⛔ CMS 엔드포인트 수정 금지 — 이 함수를 통해서만 재사용
 * ⛔ 소유권·취소가능조건은 호출부(endpoint)에서 사전 검증 완료 가정
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { env } from '$env/dynamic/private'
import { sendReservationLifecyclePush, sendPushToAdmins } from '$lib/server/push'
import { cancelDelivery, DheroApiError } from '$lib/server/dhero'

type CancelResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'TOSS_FAILED' | 'RPC_FAILED'; message: string }

type RpcCancelResult = {
  success: boolean
  cancelled_reservation_ids?: number[]
  error?: string
}

/** payment_transactions 조회 — 직접 매칭 → order_items 경유 형제 탐색 (CMS endpoint 동일 패턴) */
async function findPaymentTransaction(
  admin: SupabaseClient,
  reservationId: number,
): Promise<{ payment_key: string | null; status: string | null } | null> {
  const { data: direct } = await admin
    .from('payment_transactions')
    .select('payment_key, status')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (direct) return direct as { payment_key: string | null; status: string | null }

  // 형제 예약 경유 탐색
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id
  if (orderId == null) return null

  const { data: siblingItems } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', orderId)

  const siblingIds = ((siblingItems ?? []) as { reservation_id: number | null }[])
    .map((r) => r.reservation_id)
    .filter((v): v is number => v != null)

  if (siblingIds.length === 0) return null

  const { data: sibling } = await admin
    .from('payment_transactions')
    .select('payment_key, status')
    .in('reservation_id', siblingIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (sibling as { payment_key: string | null; status: string | null } | null) ?? null
}

export async function cancelReservationWithRefund({
  reservationId,
  callerId,
  cancelReason,
}: {
  reservationId: number
  callerId: string
  cancelReason: string
}): Promise<CancelResult> {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ─── 1. payment_key 조회 ───────────────────────────────────────────────
  const pt = await findPaymentTransaction(admin, reservationId)
  const paymentKey = pt?.payment_key
  if (!paymentKey) {
    return { ok: false, code: 'NOT_FOUND', message: '결제 정보를 찾을 수 없습니다.' }
  }

  // ─── 더블가드: 이미 cancelled인 예약 차단 ────────────────────────────
  const { data: rvCheck } = await admin
    .from('rental_reservations')
    .select('status')
    .eq('id', reservationId)
    .maybeSingle()
  if ((rvCheck as { status?: string } | null)?.status === 'cancelled') {
    return { ok: false, code: 'NOT_FOUND', message: '이미 취소된 예약입니다.' }
  }

  // ─── 2. Toss 전액 취소 API ───────────────────────────────────────────
  const tossSecretKey = env.TOSS_SECRET_KEY
  const tossAuth = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')

  const tossRes = await fetch(
    `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
    {
      method: 'POST',
      headers: { Authorization: tossAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason }),
    },
  )
  const tossData = (await tossRes.json()) as Record<string, unknown>

  if (!tossRes.ok) {
    const code = (tossData.code as string) ?? 'TOSS_ERROR'
    const msg = (tossData.message as string) ?? '결제 취소에 실패했습니다.'
    return { ok: false, code: 'TOSS_FAILED', message: `[${code}] ${msg}` }
  }

  // ─── 3. DB 상태 갱신 — cancel_reservation_payment RPC (3회 재시도) ──
  const MAX_RPC_ATTEMPTS = 3
  const RPC_RETRY_DELAY_MS = 600

  let rpcResult: RpcCancelResult | null = null
  let lastRpcErr: { message: string } | null = null

  for (let attempt = 0; attempt < MAX_RPC_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, RPC_RETRY_DELAY_MS))
    }
    const { data, error } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: reservationId,
      p_admin_id: callerId,
      p_cancel_reason: cancelReason,
    })
    if (error) {
      lastRpcErr = error as { message: string }
      continue
    }
    const r = data as RpcCancelResult | null
    if (!r || r.success === false) {
      lastRpcErr = { message: r?.error ?? 'RPC returned success:false' }
      continue
    }
    rpcResult = r
    lastRpcErr = null
    break
  }

  // ─── RPC 전부 실패: fail-soft + RPC_FAILED 반환 ──────────────────────
  if (!rpcResult || lastRpcErr) {
    const failureReason = lastRpcErr?.message ?? '알 수 없는 오류'

    // DB 실패 기록 (fail-soft)
    try {
      await admin
        .from('payment_transactions')
        .update({ refund_failed_at: new Date().toISOString(), refund_failure_reason: failureReason })
        .eq('payment_key', paymentKey)
    } catch (e) {
      // fail-soft
    }

    // 관리자 푸시 알림 (fail-soft)
    try {
      await sendPushToAdmins('payment_completed', {
        title: '[고객취소] 환불 처리 실패 — 확인 필요',
        body: `예약 #${reservationId}: Toss 취소는 완료됐으나 DB 반영 실패. Toss 콘솔 확인 필요.`,
        link: `/cms/reservation?selected=${reservationId}`,
      })
    } catch (e) {
      // fail-soft
    }

    // 관리자 전용 채팅카드 (fail-soft)
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
            content: '[고객취소] PG 환불 처리 실패 — 확인 필요',
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
    } catch (e) {
      // fail-soft
    }

    return { ok: false, code: 'RPC_FAILED', message: `DB 반영 실패: ${failureReason}. Toss 취소는 이미 완료됐습니다.` }
  }

  // ─── 4. 취소 알림 — fail-soft ─────────────────────────────────────────
  const cancelledIds: number[] = rpcResult.cancelled_reservation_ids ?? []

  for (const rsvId of cancelledIds) {
    try {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: rsvId,
        p_notify_type: 'reservation_cancelled',
      })
    } catch (e) {
      // fail-soft
    }
    try {
      await sendReservationLifecyclePush(admin, rsvId, 'reservation_cancelled')
    } catch (e) {
      // fail-soft
    }
    // 두발히어로 취소 (운송장 있을 때만)
    try {
      const { data: rsvRow } = await admin
        .from('rental_reservations')
        .select('tracking_number')
        .eq('id', rsvId)
        .maybeSingle()
      const trackingNumber = (rsvRow as { tracking_number?: string | null } | null)?.tracking_number
      if (trackingNumber) {
        try {
          await cancelDelivery(trackingNumber)
        } catch (e) {
          if (!(e instanceof DheroApiError && e.statusCode === 412)) {
            // fail-soft
          }
        }
      }
    } catch (e) {
      // fail-soft
    }
  }

  return { ok: true }
}
