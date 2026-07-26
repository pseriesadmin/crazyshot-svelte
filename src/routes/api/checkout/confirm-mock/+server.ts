import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

// PG 미연동 임시 자동 예약승인 (M3 결제 연동 전 시범서비스용)
// hold 상태의 예약을 confirmed로 전환하고 채팅 알림을 발송한다
export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ success: false, error: '인증 필요' }, { status: 401 })

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: holds, error: fetchErr } = await admin
    .from('rental_reservations')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('status', 'hold')

  if (fetchErr) return json({ success: false, error: '예약 조회 실패' }, { status: 500 })
  if (!holds?.length) return json({ success: true, confirmedCount: 0 })

  let confirmedCount = 0
  for (const hold of holds) {
    const { error: rpcErr } = await admin.rpc('update_reservation_status', {
      p_reservation_id: hold.id,
      p_new_status: 'confirmed'
    })
    if (!rpcErr) {
      confirmedCount++
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: hold.id,
        p_notify_type: 'reservation_approval'
      })
    }
  }

  return json({ success: confirmedCount > 0, confirmedCount })
}
