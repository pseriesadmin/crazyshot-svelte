import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

// 예약신청(hold) 채팅 알림 발송 — 장바구니 담기 직후 호출
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const reservationId = Number(body.reservationId)
  if (!reservationId) return json({ ok: false, error: '예약 ID 필요' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 본인 예약인지 검증
  const { data: res } = await admin
    .from('rental_reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!res) return json({ ok: false, error: '예약 없음' }, { status: 403 })

  await admin.rpc('send_rental_chat_notification', {
    p_reservation_id: reservationId,
    p_notify_type: 'reservation_hold',
  })
  // 예약신청접수 고객 푸시 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음, 갭#1 수정 2026-08-09)
  await sendReservationLifecyclePush(admin, reservationId, 'reservation_hold')

  return json({ ok: true })
}
