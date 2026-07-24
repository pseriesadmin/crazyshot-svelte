// 결제 완료 결과 페이지 — TossPayments 리다이렉트 수신 + 확인 처리
// 플로우: Toss confirm API → confirm_payment_and_update_reservation RPC → 예약 상세 조회

import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { PageServerLoad } from './$types'

const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'

export const load: PageServerLoad = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/login')

  // Toss가 전달하는 파라미터
  const paymentKey    = url.searchParams.get('paymentKey') ?? ''
  const orderId       = url.searchParams.get('orderId') ?? ''
  const amount        = Number(url.searchParams.get('amount') ?? '0')

  // successUrl에 포함시켜야 하는 파라미터 (UUID 문자열)
  const reservationId = url.searchParams.get('reservationId') ?? ''
  const idemKey       = url.searchParams.get('idemKey') ?? ''

  if (!paymentKey || !orderId || !amount || !reservationId || !idemKey) {
    throw redirect(303, '/payment/fail?code=MISSING_PARAMS&message=결제 파라미터가 누락되었습니다.')
  }

  const tossSecretKey    = env.TOSS_SECRET_KEY
  const serviceRoleKey   = env.SUPABASE_SERVICE_ROLE_KEY
  if (!tossSecretKey || !serviceRoleKey) {
    throw redirect(303, '/payment/fail?code=SERVER_ERROR&message=서버 설정 오류입니다.')
  }

  // ── 1. Toss 결제 승인 API ──────────────────────────────────────────────────
  const tossAuth = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')
  const tossRes  = await fetch(TOSS_CONFIRM_URL, {
    method:  'POST',
    headers: { 'Authorization': tossAuth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ paymentKey, orderId, amount }),
  })
  const tossData = await tossRes.json() as Record<string, unknown>

  if (!tossRes.ok) {
    const code    = (tossData.code    as string) ?? 'TOSS_ERROR'
    const message = (tossData.message as string) ?? '결제 승인에 실패했습니다.'
    throw redirect(303, `/payment/fail?reservationId=${reservationId}&code=${code}&message=${encodeURIComponent(message)}`)
  }

  // ── 2. confirm_payment_and_update_reservation RPC (service_role) ──────────
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data: rpcResult } = await admin.rpc('confirm_payment_and_update_reservation', {
    p_reservation_id:  reservationId,
    p_user_id:         session.user.id,
    p_payment_key:     paymentKey,
    p_order_id:        orderId,
    p_idempotency_key: idemKey,
    p_total_amount:    amount,
    p_paid_amount:     amount,
    p_payment_method:  (tossData.method as string) ?? null,
    p_toss_response:   tossData,
  })

  // RPC 실패 → 실패 페이지 (HOLD는 이미 살아있음, fail 페이지에서 cancel)
  const result = rpcResult as Record<string, unknown> | null
  if (!result?.success) {
    throw redirect(303, `/payment/fail?reservationId=${reservationId}&code=RPC_ERROR&message=${encodeURIComponent(String(result?.error ?? '결제 처리 중 오류가 발생했습니다.'))}`)
  }

  // ── 3. 예약 + 상품 상세 조회 (SELECT — DML 아님) ─────────────────────────
  const { data: reservation } = await admin
    .from('rental_reservations')
    .select('id, rental_start_date, rental_end_date, special_requests, product_id')
    .eq('id', reservationId)
    .single()

  type ReservationRow = {
    id: number
    rental_start_date: string | null
    rental_end_date: string | null
    special_requests: string | null
    product_id: string | null
  }
  const rv = reservation as ReservationRow | null

  // 상품명 조회
  let productName = '촬영 장비'
  if (rv?.product_id) {
    const { data: product } = await admin
      .from('products')
      .select('name')
      .eq('id', rv.product_id)
      .single()
    const p = product as { name: string } | null
    if (p?.name) productName = p.name
  }

  // 주문번호: TossPayments orderId (사용자 화면 · CMS 정합)
  const orderNumber = orderId

  // 결제일시 포맷 (ISO → "YYYY.MM.DD·HH:mm")
  const confirmedAt = (tossData.approvedAt as string) ?? new Date().toISOString()
  const confirmedDate = confirmedAt.replace(/T(\d{2}):(\d{2}).*/, '·$1:$2').replace(/-/g, '.')

  return {
    productName,
    orderNumber,
    startDate:     rv?.rental_start_date?.replace(/-/g, '.') ?? '',
    endDate:       rv?.rental_end_date?.replace(/-/g, '.') ?? '',
    amount,
    confirmedAt:   confirmedDate,
    paymentMethod: (tossData.method as string) ?? '카드',
    specialRequests: rv?.special_requests ?? '',
  }
}
