import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

// 예약 카트에서 상품 삭제 — hold 예약을 cancelled로 전환 (본인 소유 + hold 상태만 허용)
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const reservationId = Number(body.reservationId)
  if (!reservationId) return json({ ok: false, error: '예약 ID 필요' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 본인 소유 + hold 상태인지 검증
  const { data: res } = await admin
    .from('rental_reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .eq('status', 'hold')
    .maybeSingle()

  if (!res) return json({ ok: false, error: '삭제할 수 없는 예약입니다' }, { status: 403 })

  const { error } = await admin.rpc('update_reservation_status', {
    p_reservation_id: reservationId,
    p_new_status: 'cancelled',
  })

  if (error) return json({ ok: false, error: '삭제 처리 실패' }, { status: 500 })

  return json({ ok: true })
}
