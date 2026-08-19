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

  // 본인 소유 + 삭제 가능 상태(hold/draft)인지 검증 — 장바구니 조회(+page.server.ts)가
  // status IN ('hold','draft')로 두 상태를 모두 노출하는데 이 검증은 'hold'만 허용해
  // draft 상태 항목이 항상 403으로 삭제 실패하던 결함 수정(2026-08-18)
  const { data: res } = await admin
    .from('rental_reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .in('status', ['hold', 'draft'])
    .maybeSingle()

  if (!res) return json({ ok: false, error: '삭제할 수 없는 예약입니다' }, { status: 403 })

  const { data: rpcResult, error } = await admin.rpc('update_reservation_status', {
    p_reservation_id: reservationId,
    p_new_status: 'cancelled',
  })

  if (error) return json({ ok: false, error: '삭제 처리 실패' }, { status: 500 })

  // update_reservation_status는 실패를 SQL 예외가 아니라 자체 반환값({ok:false, error})으로
  // 알려주는 함수라 client-level error만 확인하면 실제 실패를 놓친다(2026-08-18 발견·수정)
  const parsed = rpcResult as { ok?: boolean; error?: string } | null
  if (!parsed?.ok) return json({ ok: false, error: parsed?.error ?? '삭제 처리 실패' }, { status: 500 })

  return json({ ok: true })
}
