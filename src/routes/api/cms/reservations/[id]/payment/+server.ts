import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { env } from '$env/dynamic/private'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { cancelDelivery, DheroApiError } from '$lib/server/dhero'

// 2026-08-31(CRITICAL 수정): confirm_order_payment_and_update_reservations(Migration 378)는
// 주문당 payment_transactions 1행만 대표 예약에 연결한다. 이 예약(params.id) 자신이 대표가
// 아닌 형제 예약(같은 주문의 다른 상품)일 수 있으므로, 직접 매칭이 없으면 order_items 경유로
// 같은 주문의 결제 행을 찾는다 — cancel_reservation_payment RPC(Migration 379/384)의
// 1a/1b 조회 패턴과 동일. 이게 없으면 형제 예약의 "결제정보" 탭이 항상 "결제 정보가
// 없습니다"로 뜨고 환불 버튼도 영구히 비활성화된다(CMS 감사로 발견).
async function findOrderPaymentTransaction(
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
    refund_failure_reason
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

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await findOrderPaymentTransaction(admin, Number(params.id))

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ payment: data ?? null })
}

// PUT — 환불 처리 (Toss 전액 취소 → cancel_reservation_payment RPC)
// 권한: manager 이상 (security-auth.md CMS 역할 매트릭스 "환불 처리")
export const PUT: RequestHandler = async ({ params, locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '환불은 매니저 이상 권한이 필요합니다.' }, { status: 403 })
  }

  const reservationId = Number(params.id)
  if (!Number.isFinite(reservationId)) return json({ error: '잘못된 예약 ID' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { cancelReason?: string }
  const cancelReason = typeof body.cancelReason === 'string' && body.cancelReason.trim()
    ? body.cancelReason.trim()
    : '관리자 환불'

  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. payment_key 조회 — 이 예약이 대표가 아닌 형제 예약이어도 같은 주문의 결제 행을 찾는다
  //    (findOrderPaymentTransaction, GET과 동일 로직 — 2026-08-31 CRITICAL 수정)
  const { data: pt } = await findOrderPaymentTransaction(admin, reservationId)

  const ptRow = pt as { payment_key?: string | null; status?: string | null } | null
  const paymentKey = ptRow?.payment_key
  if (!paymentKey) return json({ error: '결제 정보를 찾을 수 없습니다.' }, { status: 404 })

  // 더블가드: 이미 cancelled이거나 done이 아닌 결제는 환불 불가
  if (ptRow?.status !== 'done') {
    return json({ error: '환불 가능한 결제 상태가 아닙니다. (이미 취소됐거나 결제 미완료)' }, { status: 400 })
  }

  // 더블가드: 예약 상태 확인 — 이미 cancelled인 예약은 환불 불가
  const { data: rv } = await admin
    .from('rental_reservations')
    .select('status')
    .eq('id', reservationId)
    .maybeSingle()
  if ((rv as { status?: string } | null)?.status === 'cancelled') {
    return json({ error: '이미 취소된 예약입니다.' }, { status: 400 })
  }

  // 2. Toss 전액 취소 API (결제 취소는 Toss가 먼저, DB는 RPC에서)
  const tossAuth = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')
  const tossRes  = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method:  'POST',
    headers: { Authorization: tossAuth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cancelReason }),
  })
  const tossData = await tossRes.json() as Record<string, unknown>

  if (!tossRes.ok) {
    const code    = (tossData.code    as string) ?? 'TOSS_ERROR'
    const message = (tossData.message as string) ?? '결제 취소에 실패했습니다.'
    return json({ error: `[${code}] ${message}` }, { status: 400 })
  }

  // 3. DB 상태 갱신 — cancel_reservation_payment RPC
  // RSV-B-C1 (GATE B Q1 확정): Toss 취소는 이미 완료됐으므로 RPC만 최대 3회 재시도.
  // rpcErr(네트워크·타임아웃)이나 result.success:false(DB 레벨 실패) 모두 재시도 대상.
  const MAX_RPC_ATTEMPTS = 3
  const RPC_RETRY_DELAY_MS = 600
  type CancelResult = { success: boolean; payment_key?: string; cancelled_reservation_ids?: number[]; error?: string; error_code?: string }

  let rpcResult: CancelResult | null = null
  let lastRpcErr: { message: string } | null = null

  for (let attempt = 0; attempt < MAX_RPC_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, RPC_RETRY_DELAY_MS))
    }
    const { data, error } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: reservationId,
      p_admin_id:       session.user.id,
      p_cancel_reason:  cancelReason,
    })
    if (error) {
      lastRpcErr = error as { message: string }
      continue
    }
    const r = data as CancelResult | null
    if (!r || r.success === false) {
      lastRpcErr = { message: r?.error ?? 'RPC returned success:false' }
      continue
    }
    rpcResult = r
    lastRpcErr = null
    break
  }

  // 재시도 전부 실패 시: DB 실패 기록 + 관리자 알림 + 500 반환
  if (!rpcResult || lastRpcErr) {
    const failureReason = lastRpcErr?.message ?? '알 수 없는 오류'
    // ② 실패 사실 DB 기록 (fail-soft — 기록 실패가 응답을 막으면 안 됨)
    try {
      await admin
        .from('payment_transactions')
        .update({
          refund_failed_at:      new Date().toISOString(),
          refund_failure_reason: failureReason,
        })
        .eq('payment_key', paymentKey)
    } catch (dbErr) {
      console.error('[refund/rpc-fail] DB 실패기록 오류(fail-soft):', dbErr instanceof Error ? dbErr.message : dbErr)
    }
    // ③ 관리자 알림 (fail-soft)
    try {
      const { sendPushToAdmins } = await import('$lib/server/push')
      await sendPushToAdmins('payment_completed', {
        title: '환불 처리 실패 — 확인 필요',
        body: `예약 #${reservationId}: Toss 취소는 완료됐으나 DB 반영에 실패했습니다. Toss 콘솔에서 직접 확인해주세요.`,
        link: `/cms/reservation?selected=${reservationId}`,
      })
    } catch (pushErr) {
      console.error('[refund/rpc-fail] 관리자 알림 오류(fail-soft):', pushErr instanceof Error ? pushErr.message : pushErr)
    }
    // ④ 관리자 전용 채팅 카드 삽입 (fail-soft, service-operations.md §11 공용 RPC 경유)
    // admin_only=true: 고객 채팅에는 미노출, 관리자 채팅 패널에서만 확인 가능
    try {
      // 이 예약의 user_id 조회
      const { data: rvForChat } = await admin
        .from('rental_reservations')
        .select('user_id')
        .eq('id', reservationId)
        .maybeSingle()
      const chatUserId = (rvForChat as { user_id?: string | null } | null)?.user_id
      if (chatUserId) {
        const { data: chatSessionId, error: chatSessionErr } = await admin.rpc('find_or_create_general_chat_session', {
          p_user_id: chatUserId,
          p_reservation_id: reservationId,
        })
        if (chatSessionErr) {
          console.error('[refund/rpc-fail] find_or_create_general_chat_session 실패(fail-soft):', chatSessionErr.message)
        }
        if (chatSessionId) {
          await admin.from('chat_messages').insert({
            session_id:   chatSessionId,
            sender_type:  'admin',
            message_type: 'action_card',
            content:      'PG 환불실패 정보를 확인하세요.',
            admin_only:   true,
            action_payload: {
              type:           'refund_failed',
              reservation_id: String(reservationId),
              action_url:     `/cms/reservation?selected=${reservationId}`,
              button_label:   '환불실패확인',
            },
          })
        }
      }
    } catch (chatErr) {
      console.error('[refund/rpc-fail] 관리자 채팅카드 삽입 오류(fail-soft):', chatErr instanceof Error ? chatErr.message : chatErr)
    }
    return json(
      { error: `DB 반영 실패: ${failureReason}. Toss 취소는 이미 완료됐습니다 — Toss 콘솔에서 직접 확인해주세요.` },
      { status: 500 },
    )
  }

  const result = rpcResult
  const cancelledIds: number[] = result?.cancelled_reservation_ids ?? []

  // 4. 취소된 예약 각각에 알림·두발히어로 취소 — fail-soft (환불 자체는 이미 완료)
  for (const rsvId of cancelledIds) {
    // 채팅 알림 (reservation_cancelled — AUTO_NOTIFY 매핑)
    try {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: rsvId,
        p_notify_type:    'reservation_cancelled',
      })
    } catch (e) {
      console.error(`[refund/chat-notify] fail-soft [${rsvId}]:`, e instanceof Error ? e.message : e)
    }
    // 브라우저 푸시
    try {
      await sendReservationLifecyclePush(admin, rsvId, 'reservation_cancelled')
    } catch (e) {
      console.error(`[refund/push-notify] fail-soft [${rsvId}]:`, e instanceof Error ? e.message : e)
    }
    // 두발히어로 취소 — tracking_number 있을 때만 (배송 접수된 경우)
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
          // 412: 이미 취소됨 등 — 무시 가능
          if (!(e instanceof DheroApiError && e.statusCode === 412)) {
            console.error(`[refund/dhero-cancel] fail-soft [${rsvId}]:`, e instanceof Error ? e.message : e)
          }
        }
      }
    } catch (e) {
      console.error(`[refund/dhero-lookup] fail-soft [${rsvId}]:`, e instanceof Error ? e.message : e)
    }
  }

  return json({ ok: true, cancelledIds })
}
