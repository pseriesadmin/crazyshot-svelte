import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

// PG 미연동 임시 자동 예약승인 (M3 결제 연동 전 시범서비스용)
// hold 상태의 예약을 confirmed로 전환하고 채팅 알림을 발송한다
// reservationIds가 전달되면 그 목록만 확정(체크 해제한 상품은 결제 확정 대상에서 제외) —
// 미전달 시(하위호환) 사용자의 hold 전체를 확정
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ success: false, error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const requestedIds = Array.isArray(body.reservationIds)
    ? (body.reservationIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
    : null

  if (requestedIds !== null && requestedIds.length === 0) {
    return json({ success: false, error: '선택된 예약이 없습니다', confirmedCount: 0, confirmedReservations: [] })
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  let holdsQuery = admin
    .from('rental_reservations')
    .select('id, reservation_code')
    .eq('user_id', session.user.id)
    .eq('status', 'hold')
  if (requestedIds !== null) holdsQuery = holdsQuery.in('id', requestedIds)

  const { data: holds, error: fetchErr } = await holdsQuery

  if (fetchErr) return json({ success: false, error: '예약 조회 실패' }, { status: 500 })
  if (!holds?.length) return json({ success: true, confirmedCount: 0, confirmedReservations: [] })

  const confirmedReservations: { id: number; reservationCode: string | null }[] = []
  for (const hold of holds) {
    const { error: rpcErr } = await admin.rpc('update_reservation_status', {
      p_reservation_id: hold.id,
      p_new_status: 'confirmed'
    })
    if (!rpcErr) {
      confirmedReservations.push({ id: hold.id, reservationCode: hold.reservation_code })
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: hold.id,
        p_notify_type: 'reservation_approval'
      })
    }
  }

  return json({
    success: confirmedReservations.length > 0,
    confirmedCount: confirmedReservations.length,
    confirmedReservations,
  })
}
