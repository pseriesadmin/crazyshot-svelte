/**
 * /pay/late-fee/[id] — 연체료 결제 랜딩 페이지 서버 로드
 * window.open(_blank)으로 채팅 CTA에서 열리는 별도 창
 * 소유권 검증: 고객 A가 고객 B의 연체료에 접근 불가
 */
import { redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { PageServerLoad } from './$types'

export interface LateFeeDetail {
  id: string
  reservation_id: number
  fee_amount: number
  hours_late: number
  is_paid: boolean
  paid_at: string | null
  reservation_code: string | null
  end_date: string | null
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const lateFeeId = params.id
  if (!lateFeeId) throw redirect(303, '/account')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 1단계: late_fees 조회
  const { data: feeRaw, error: feeErr } = await admin
    .from('late_fees')
    .select('id, reservation_id, fee_amount, hours_late, is_paid, paid_at')
    .eq('id', lateFeeId)
    .maybeSingle()

  if (feeErr || !feeRaw) throw redirect(303, '/account')

  const fee = feeRaw as {
    id: string
    reservation_id: number
    fee_amount: number
    hours_late: number
    is_paid: boolean
    paid_at: string | null
  }

  // 2단계: 예약 소유권 + 예약 정보 조회
  const { data: reservationRaw, error: resErr } = await admin
    .from('rental_reservations')
    .select('id, user_id, reservation_code, end_date')
    .eq('id', fee.reservation_id)
    .maybeSingle()

  if (resErr || !reservationRaw) throw redirect(303, '/account')

  const reservation = reservationRaw as {
    id: number
    user_id: string
    reservation_code: string | null
    end_date: string | null
  }

  // 소유권 검증 — 다른 고객의 연체료 접근 차단
  if (reservation.user_id !== session.user.id) {
    throw redirect(303, '/account')
  }

  const lateFee: LateFeeDetail = {
    id:               fee.id,
    reservation_id:   fee.reservation_id,
    fee_amount:       fee.fee_amount,
    hours_late:       fee.hours_late,
    is_paid:          fee.is_paid,
    paid_at:          fee.paid_at,
    reservation_code: reservation.reservation_code,
    end_date:         reservation.end_date,
  }

  return { lateFee }
}
