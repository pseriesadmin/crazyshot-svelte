// 결제 실패 / 중지 결과 페이지
// 플로우: Toss 결제 취소 or 결제 승인 실패 → 이 페이지로 리다이렉트
// reservationId가 있으면 cancel_payment_and_release_hold RPC로 HOLD 해제

import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url, locals }) => {
  const code        = url.searchParams.get('code') ?? 'UNKNOWN'
  const message     = url.searchParams.get('message') ?? '결제가 취소되었습니다.'
  const reservationIdRaw = url.searchParams.get('reservationId')
  const reservationId    = reservationIdRaw ? Number(reservationIdRaw) : null

  // HOLD 해제 시도 (reservationId 있고, 로그인 세션 있을 때)
  if (reservationId) {
    const { session } = await locals.safeGetSession()
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

    if (session && serviceRoleKey) {
      const admin = createClient(getSupabaseUrl(), serviceRoleKey)
      await admin.rpc('cancel_payment_and_release_hold', {
        p_reservation_id: reservationId,
        p_user_id:        session.user.id,
        p_reason:         `결제 실패: ${code}`,
      })
      // 실패해도 페이지는 계속 렌더링 (HOLD는 10분 후 pg_cron 자동 해제됨)
    }
  }

  return {
    code,
    message: decodeURIComponent(message),
    reservationId,
  }
}
