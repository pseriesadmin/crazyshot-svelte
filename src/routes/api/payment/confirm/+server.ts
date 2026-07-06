// POST /api/payment/confirm — 토스페이먼츠 결제 승인 + 예약 confirmed 전환
// payment.md 플로우:
//   1. calc_at 30초 유효성 검증 (PRICE_EXPIRED)
//   2. 토스 결제 승인 API 호출 (HMAC-SHA256 인증)
//   3. confirm_payment_and_update_reservation RPC (원자적)
//   4. 결제 실패 시 cancel_payment_and_release_hold RPC

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'
const CALC_VALIDITY_SECONDS = 30

interface ConfirmRequest {
  paymentKey: string
  orderId: string
  amount: number
  reservationId: number
  idempotencyKey: string
  calcAt: string
  pointAmount?: number
  couponDiscount?: number
  depositAmount?: number
  depositRate?: number
  crazyshotScore?: number
}

interface TossConfirmResponse {
  paymentKey: string
  orderId: string
  status: string
  method?: string
  totalAmount: number
  approvedAt?: string
  [key: string]: unknown
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const body = await request.json() as ConfirmRequest
  const {
    paymentKey,
    orderId,
    amount,
    reservationId,
    idempotencyKey,
    calcAt,
    pointAmount = 0,
    couponDiscount = 0,
    depositAmount = 0,
    depositRate = 0,
    crazyshotScore,
  } = body

  // 1. 필수 필드 검증
  if (!paymentKey || !orderId || !amount || !reservationId || !idempotencyKey || !calcAt) {
    return json({ error: 'MISSING_FIELDS', message: '필수 파라미터가 누락되었습니다.' }, { status: 400 })
  }

  // 2. calc_at 30초 유효성 검증
  const calcAge = (Date.now() - new Date(calcAt).getTime()) / 1000
  if (calcAge > CALC_VALIDITY_SECONDS) {
    return json({ error: 'PRICE_EXPIRED', message: '금액 정보가 만료되었습니다. 다시 확인해주세요.' }, { status: 400 })
  }

  // 3. 토스 결제 승인 API 호출
  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) {
    return json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  }

  const tossAuthHeader = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')

  let tossResponse: TossConfirmResponse
  try {
    const tossRes = await fetch(TOSS_CONFIRM_URL, {
      method: 'POST',
      headers: {
        'Authorization': tossAuthHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })

    tossResponse = await tossRes.json() as TossConfirmResponse

    if (!tossRes.ok) {
      // 토스 API 오류 → HOLD 해제 없이 반환 (아직 HOLD 상태임)
      return json(
        { error: 'TOSS_API_ERROR', message: tossResponse as unknown as string },
        { status: 400 }
      )
    }
  } catch {
    return json({ error: 'TOSS_NETWORK_ERROR', message: '결제 서버 연결 오류입니다.' }, { status: 502 })
  }

  // 4. service_role로 RPC 호출 (SECURITY DEFINER 함수)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('confirm_payment_and_update_reservation', {
    p_reservation_id:  reservationId,
    p_user_id:         session.user.id,
    p_payment_key:     paymentKey,
    p_order_id:        orderId,
    p_idempotency_key: idempotencyKey,
    p_total_amount:    amount,
    p_paid_amount:     amount - pointAmount - couponDiscount,
    p_point_amount:    pointAmount,
    p_coupon_discount: couponDiscount,
    p_payment_method:  tossResponse.method ?? null,
    p_toss_response:   tossResponse,
    p_calc_at:         calcAt,
    p_deposit_amount:  depositAmount,
    p_deposit_rate:    depositRate,
    p_crazyshot_score: crazyshotScore ?? null,
  })

  if (error || !data?.success) {
    // RPC 오류 → HOLD 해제 시도
    await admin.rpc('cancel_payment_and_release_hold', {
      p_reservation_id: reservationId,
      p_user_id:        session.user.id,
      p_reason:         `confirm RPC 오류: ${error?.message ?? data?.error ?? '알 수 없음'}`,
    })

    return json(
      { error: 'RESERVATION_ERROR', message: data?.error ?? error?.message },
      { status: 500 }
    )
  }

  return json({
    success: true,
    paymentId: data.payment_id,
    depositId: data.deposit_id ?? null,
    idempotent: data.idempotent,
  })
}
