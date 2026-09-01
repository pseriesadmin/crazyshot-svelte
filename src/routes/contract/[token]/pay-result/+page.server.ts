// Toss 결제 리다이렉트 수신 → 계약서명 결제 확정 (로그인 세션 불필요 — 토큰 기반)
// 플로우: Toss successUrl 리다이렉트 → Toss confirm API → confirm_order_payment_and_update_reservations
//         → 알림/푸시 → 쿠폰·포인트 소진 → /contract/complete
//
// 인증: /api/contracts/[token]/pay-mock과 동일한 토큰 기반 신뢰 모델 (contract.md 정책)
// 멱등: confirm_order_payment_and_update_reservations의 idempotency_key(= toss orderId)로 보장

import { redirect }          from '@sveltejs/kit'
import { env }               from '$env/dynamic/private'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL }       from '$env/static/public'
import { createClient }      from '@supabase/supabase-js'
import { sendPaymentCompletedAdminPush } from '$lib/server/push'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import type { PageServerLoad } from './$types'

const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'

export const load: PageServerLoad = async ({ params, url }) => {
  const { token } = params
  const failBase  = `/contract/${token}?payStatus=fail`

  // ── Toss가 successUrl에 추가하는 파라미터 ─────────────────────────────────
  const paymentKey  = url.searchParams.get('paymentKey') ?? ''
  const tossOrderId = url.searchParams.get('orderId')    ?? ''
  const amount      = Number(url.searchParams.get('amount') ?? '0')

  // successUrl에 인코딩해 둔 커스텀 파라미터 (쿠폰·포인트)
  const couponId = url.searchParams.get('couponId') || null   // 빈 문자열 → null
  const points   = Number(url.searchParams.get('points') ?? '0')

  if (!paymentKey || !tossOrderId || !amount) {
    throw redirect(303, `${failBase}&code=MISSING_PARAMS`)
  }

  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) throw redirect(303, `${failBase}&code=SERVER_ERROR`)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 1. 토큰 → 서명 정보 → 서명 완료 검증 ──────────────────────────────────
  const { data: signing } = await admin
    .from('contract_signings')
    .select('id, contract_id, user_id, signed_at')
    .eq('token', token)
    .maybeSingle()

  const s = signing as {
    id: string
    contract_id: string | null
    user_id: string | null
    signed_at: string | null
  } | null

  if (!s?.contract_id) {
    throw redirect(303, `${failBase}&code=INVALID_TOKEN`)
  }
  if (!s.signed_at) {
    // 서명 없이 pay-result에 도달하는 비정상 경로 — 서명 단계로 복귀
    throw redirect(303, `/contract/${token}?payStatus=fail&code=NOT_SIGNED`)
  }

  // ── 2. contract → reservation_id ──────────────────────────────────────────
  const { data: contract } = await admin
    .from('contracts')
    .select('reservation_id')
    .eq('id', s.contract_id)
    .maybeSingle()

  const reservationId = (contract as { reservation_id?: number | null } | null)?.reservation_id
  if (!reservationId) {
    throw redirect(303, `${failBase}&code=NO_RESERVATION`)
  }

  // ── 3. 예약 조회 + 멱등 안전망 ────────────────────────────────────────────
  const { data: reservation } = await admin
    .from('rental_reservations')
    .select('id, user_id, status')
    .eq('id', reservationId)
    .maybeSingle()

  const rv = reservation as { id: number; user_id: string | null; status: string } | null
  if (!rv) throw redirect(303, `${failBase}&code=NO_RESERVATION`)

  // 이미 confirmed(관리자 수동승인 등)이면 no-op 처리
  if (rv.status === 'confirmed') throw redirect(303, '/contract/complete')
  // 취소·만료 등 비정상 상태
  if (rv.status !== 'hold') {
    throw redirect(303, `${failBase}&code=RESERVATION_NOT_ACTIVE`)
  }

  const userId = rv.user_id ?? s.user_id
  if (!userId) throw redirect(303, `${failBase}&code=NO_USER`)

  // ── 4. order_items → 내부 주문 ID(BIGINT) + 형제 예약 ID 목록 ──────────────
  const { data: ownItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  const internalOrderId = (ownItem as { order_id: number | null } | null)?.order_id
  if (!internalOrderId) throw redirect(303, `${failBase}&code=NO_ORDER`)

  const { data: orderItems } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', internalOrderId)

  const reservationIds: number[] = (
    (orderItems ?? []) as { reservation_id: number | null }[]
  )
    .map((r) => r.reservation_id)
    .filter((v): v is number => v != null)

  if (reservationIds.length === 0) reservationIds.push(reservationId)

  // ── 5. orders 테이블 → 총금액 조회 (쿠폰할인 역산 = total - paid - points) ──
  const { data: orderRow } = await admin
    .from('orders')
    .select('final_amount')
    .eq('id', internalOrderId)
    .maybeSingle()

  const totalAmount    = (orderRow as { final_amount?: number | null } | null)?.final_amount ?? amount
  const couponDiscount = Math.max(0, totalAmount - amount - points)

  // ── 5b. 이중결제 방지 가드 — Toss confirm 전 payment_transactions 존재 확인 ──
  // 동시 재진입(rv.status === 'hold' 체크 통과 직후) 시나리오 방어
  // tossOrderId는 payment_transactions.order_id(TEXT)이자 idempotency_key 양쪽으로 저장됨
  const { data: existingPt } = await admin
    .from('payment_transactions')
    .select('id')
    .or(`idempotency_key.eq.${tossOrderId},order_id.eq.${tossOrderId}`)
    .maybeSingle()
  if (existingPt) {
    // 이미 확정된 결제 — 성공 처리로 리다이렉트 (Toss confirm 재호출 방지)
    throw redirect(303, '/contract/complete')
  }

  // ── 6. Toss 결제 승인 API (서버→Toss) ─────────────────────────────────────
  const tossAuth = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')
  const tossRes  = await fetch(TOSS_CONFIRM_URL, {
    method:  'POST',
    headers: { Authorization: tossAuth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ paymentKey, orderId: tossOrderId, amount }),
  })
  const tossData = await tossRes.json() as Record<string, unknown>

  if (!tossRes.ok) {
    const code    = (tossData.code    as string) ?? 'TOSS_ERROR'
    const message = (tossData.message as string) ?? '결제 승인에 실패했습니다.'
    throw redirect(
      303,
      `${failBase}&code=${encodeURIComponent(code)}&message=${encodeURIComponent(message)}`,
    )
  }

  // ── 7. confirm_order_payment_and_update_reservations RPC ──────────────────
  const { data: rpcResult, error: confirmRpcErr } = await admin.rpc('confirm_order_payment_and_update_reservations', {
    p_order_id:        internalOrderId,
    p_reservation_ids: reservationIds,
    p_payment_key:     paymentKey,
    p_toss_order_id:   tossOrderId,
    p_idempotency_key: tossOrderId,           // Toss orderId = 자연스러운 멱등키
    p_total_amount:    totalAmount,
    p_paid_amount:     amount,
    p_point_amount:    points,
    p_coupon_discount: couponDiscount,
    p_payment_method:  (tossData.method as string) ?? null,
    p_toss_response:   tossData,
    p_calc_at:         (tossData.approvedAt as string) ?? new Date().toISOString(),
  })

  if (confirmRpcErr) {
    // Toss는 이미 결제를 승인(위 6단계 완료)했는데 이 RPC 자체가 실패하면 "돈은 받았는데
    // DB엔 결제·예약 확정이 반영 안 된" 상태가 된다 — 반드시 상세 로그를 남겨야
    // 운영자가 Toss 콘솔과 대조해 수동 정합화할 수 있다(§9 배포순서사고와 동일 급의 위험군).
    console.error('[contract/pay-result] confirm_order_payment_and_update_reservations 실패 — Toss 결제는 이미 승인됨:', confirmRpcErr.message, {
      internalOrderId, tossOrderId, paymentKey, amount,
    })
  }

  const result = rpcResult as { success?: boolean; idempotent?: boolean; error?: string } | null
  if (!result?.success) {
    const errMsg = result?.error ?? confirmRpcErr?.message ?? '결제 처리 중 오류가 발생했습니다.'
    throw redirect(
      303,
      `${failBase}&code=RPC_ERROR&message=${encodeURIComponent(errMsg)}`,
    )
  }

  // ── 8. 알림/푸시/쿠폰·포인트 소진 (idempotent 재시도 시 중복 방지) ──────────
  if (!result.idempotent) {
    // 관리자 결제완료 푸시 — 승인 관련 고객 알림과 별도로 즉시 발송
    await sendPaymentCompletedAdminPush(admin, reservationId, userId, amount)

    // §9 게이팅 통과 여부 재확인 — confirm_order_payment_and_update_reservations RPC는
    // 내부에서 try_confirm_reservation()을 PERFORM(반환값 버림)으로 호출해 리턴 JSON에
    // confirmed 필드가 없다. 결제만 완료됐고 서명이 아직 안 된 경우(AND 조건 미충족)엔
    // 예약이 confirmed로 전환되지 않으므로, 승인 알림을 발송하면 안 된다.
    // → RPC 호출 직후 rental_reservations.status를 직접 재조회해 실제 confirmed인지 확인한다.
    const { data: confirmedCheck } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .maybeSingle()

    if ((confirmedCheck as { status: string } | null)?.status === 'confirmed') {
      // 채팅 알림 + 고객 푸시 — 공용 헬퍼로 통합 (NTF-C2 수정, 2026-08-31)
      // mode='hold' 시 채팅·푸시 둘 다 보류. 푸시는 §4 판정 이후에만 발송 — service-operations.md §4/§15
      const notifyPlan = await resolveApprovalNotifyPlan(admin, reservationId)
      await sendApprovalNotifications(admin, reservationId, notifyPlan)
    }

    // 쿠폰/포인트 소진 — 실패는 결제 확정 이후라 롤백 없음(운영팀 수동 확인), 독립 처리
    if (couponId) {
      try {
        await admin.rpc('use_coupon', {
          p_user_id:        userId,
          p_user_coupon_id: couponId,
          p_order_id:       internalOrderId,
        })
      } catch { /* 쿠폰 실패는 결제 성공과 독립 */ }
    }
    if (points > 0) {
      try {
        await admin.rpc('use_points', {
          p_user_id:  userId,
          p_points:   points,
          p_order_id: internalOrderId,
        })
      } catch { /* 포인트 실패도 독립 처리 */ }
    }
  }

  throw redirect(303, '/contract/complete')
}
