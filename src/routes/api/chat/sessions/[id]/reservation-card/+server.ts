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

export const POST: RequestHandler = async ({ params, locals }) => {
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
  }

  return json({ ok: true })
}
