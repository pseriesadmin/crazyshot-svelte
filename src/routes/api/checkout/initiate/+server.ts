// POST /api/checkout/initiate
// 결제 전 HOLD 예약 생성 → 금액 계산 → Toss 파라미터 반환
// 플로우: checkout CTA → 이 엔드포인트 → Toss SDK requestPayment
//         → Toss 리다이렉트 → /payment/success (confirm)

import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { randomUUID } from 'crypto'
import type { RequestHandler } from './$types'

interface InitiateBody {
  productId: string
  startDate: string
  endDate: string
  orderName: string
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const body = await request.json() as InitiateBody
  const { productId, startDate, endDate, orderName } = body

  if (!productId || !startDate || !endDate) {
    throw error(400, '필수 파라미터(productId, startDate, endDate)가 누락되었습니다.')
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw error(500, '서버 설정 오류입니다.')

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // ── 1. HOLD 예약 생성 (10분 만료, 중복 자동 차단) ────────────────────────
  const { data: reserveRows, error: reserveErr } = await admin.rpc('atomic_reserve_asset', {
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date:   endDate,
    p_user_id:    session.user.id,
  })

  if (reserveErr) throw error(500, reserveErr.message)

  const reserve = (Array.isArray(reserveRows) ? reserveRows[0] : reserveRows) as {
    success: boolean
    reservation_id: string | null
    error_message: string | null
  } | null

  if (!reserve?.success || !reserve.reservation_id) {
    throw error(409, reserve?.error_message ?? '예약 가능한 재고가 없습니다.')
  }

  const reservationId = reserve.reservation_id   // UUID

  // ── 2. 금액 계산 (9단계 할인 순서 적용) ─────────────────────────────────
  const { data: totals } = await admin.rpc('calculate_cart_total', {
    p_reservation_ids: [reservationId],
    p_user_id:         session.user.id,
  })

  const totalRow = (Array.isArray(totals) ? totals[0] : totals) as {
    final_total: number
  } | null

  const amount = totalRow?.final_total ?? 0

  // ── 3. Toss 주문 ID + 멱등키 생성 ────────────────────────────────────────
  const orderId  = `CZ-${Date.now()}-${randomUUID().slice(0, 8)}`
  const idemKey  = randomUUID()

  return json({
    reservationId,
    orderId,
    idemKey,
    amount,
    orderName: orderName || '크레이지샷 장비 대여',
  })
}
