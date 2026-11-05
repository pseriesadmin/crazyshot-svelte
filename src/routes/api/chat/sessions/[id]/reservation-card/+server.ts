// POST /api/chat/sessions/[id]/reservation-card
// 예약 컨텍스트 채팅 세션(context_reservation_id)을 열 때마다 호출 — 새로 만든 세션이든
// (loadUserSession으로 찾은) 기존 open/pending 세션이든 상관없이, "예약코드·대표 상품명·
// 대여기간" 요약 대화카드가 없으면 채워 넣는다(있으면 아무 것도 안 함, idempotent).
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { ensureReservationCard } from '$lib/server/chatReservationCard'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 세션 소유권 + context_reservation_id는 DB에 이미 저장된 값만 신뢰(클라이언트 입력 없음)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chatSession } = await (admin as any)
    .from('chat_sessions')
    .select('user_id, context_type, context_reservation_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!chatSession || chatSession.user_id !== session.user.id) {
    return json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const cs = chatSession as { context_type: string; context_reservation_id: number | null }
  if (cs.context_type === 'reservation' && cs.context_reservation_id) {
    await ensureReservationCard(admin, params.id as string, cs.context_reservation_id)
    return json({ ok: true })
  }

  // 고객당 대화 1개 원칙(2026-11-05): 예약 상담은 일반 대화에 이어 붙는다 — 요청 본문의 예약 번호는
  // 본인 소유 예약일 때만 신뢰한다(타인 예약 카드를 내 대화에 넣지 못하게)
  let reservationId = 0
  try {
    const body = (await request.json()) as { reservation_id?: unknown }
    reservationId = Number(body.reservation_id)
  } catch {
    return json({ ok: true })
  }
  if (cs.context_type === 'general' && Number.isInteger(reservationId) && reservationId > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: owned } = await (admin as any)
      .from('rental_reservations')
      .select('id')
      .eq('id', reservationId)
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (owned) await ensureReservationCard(admin, params.id as string, reservationId)
  }

  return json({ ok: true })
}
