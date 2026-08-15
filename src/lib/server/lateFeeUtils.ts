// src/lib/server/lateFeeUtils.ts
// 연체료 결제 — 소유권 검증 + 중복결제 방지 순수 헬퍼
//
// API 라우트에서 주입받은 admin 클라이언트로 late_fees + rental_reservations를 조회.
// 결과를 discriminated union으로 반환 → 호출자가 HTTP 상태코드를 직접 결정.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LateFeeRow {
  id: string
  reservation_id: number
  fee_amount: number
  hours_late: number
  is_paid: boolean
}

export type LateFeeAccessResult =
  | { ok: true; lateFee: LateFeeRow }
  | { ok: false; status: 403 | 404 | 409; error: string }

/**
 * late_fee_id에 해당하는 연체료를 조회하고 소유권·결제 여부를 검증한다.
 *
 * 반환:
 *   ok:true  → lateFee (미납 상태, 소유자 일치)
 *   ok:false → status:404 (연체료 없음) / 403 (소유권 불일치) / 409 (이미 결제됨)
 */
export async function validateLateFeeAccess(
  lateFeeId: string,
  userId: string,
  admin: SupabaseClient,
): Promise<LateFeeAccessResult> {
  // 1단계: late_fees 조회
  const { data: feeRaw } = await admin
    .from('late_fees')
    .select('id, reservation_id, fee_amount, hours_late, is_paid')
    .eq('id', lateFeeId)
    .maybeSingle()

  if (!feeRaw) {
    return { ok: false, status: 404, error: '연체료를 찾을 수 없습니다.' }
  }

  const fee = feeRaw as LateFeeRow

  // 2단계: 이미 결제된 연체료 차단
  if (fee.is_paid) {
    return { ok: false, status: 409, error: '이미 결제된 연체료입니다.' }
  }

  // 3단계: 예약 소유권 확인 (late_fees에 user_id 없음 → rental_reservations JOIN)
  const { data: reservationRaw } = await admin
    .from('rental_reservations')
    .select('id, user_id')
    .eq('id', fee.reservation_id)
    .maybeSingle()

  if (!reservationRaw) {
    return { ok: false, status: 404, error: '예약을 찾을 수 없습니다.' }
  }

  const reservation = reservationRaw as { id: number; user_id: string }

  if (reservation.user_id !== userId) {
    return { ok: false, status: 403, error: '이 연체료에 접근할 권한이 없습니다.' }
  }

  return { ok: true, lateFee: fee }
}
