import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

// 대여수량(qty) 다중예약 중 일부만 성공했을 때 전량 롤백용 — 본인 소유 hold 예약만 취소한다.
// update_reservation_status는 소유자 검증이 없는 service_role 전용 RPC이므로 여기서 먼저
// 소유권을 확인한다(cancel_payment_and_release_hold는 status IN ('temp','pending','confirmed')만
// 처리해 'hold' 상태에는 적용되지 않아 이 용도로 쓸 수 없음 — Stage DB 직접 확인 완료).
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const reservationId = Number(body.reservationId)
  if (!Number.isFinite(reservationId)) {
    return json({ error: 'reservationId가 필요합니다' }, { status: 400 })
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: row } = await admin
    .from('rental_reservations')
    .select('user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (!row || row.user_id !== session.user.id) {
    return json({ error: '본인 예약만 취소할 수 있습니다' }, { status: 403 })
  }

  type UpdateStatusRpcFn = (
    name: 'update_reservation_status',
    args: { p_reservation_id: number; p_new_status: string }
  ) => Promise<{ data: { ok: boolean; error?: string } | null; error: unknown }>
  const { data, error } = await (admin.rpc as unknown as UpdateStatusRpcFn)(
    'update_reservation_status',
    { p_reservation_id: reservationId, p_new_status: 'cancelled' }
  )

  if (error || !data?.ok) {
    console.error('[reservations/cancel-hold] 취소 실패:', error ?? data?.error)
    return json({ error: '예약 취소 실패' }, { status: 500 })
  }

  return json({ success: true })
}
