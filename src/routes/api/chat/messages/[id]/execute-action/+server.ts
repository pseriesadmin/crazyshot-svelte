// POST /api/chat/messages/[id]/execute-action
// 액션카드 버튼 클릭 전 서버측 만료 재검증 (CS-A2)
// 클라이언트 expires_at 비교를 신뢰하지 않고 서버에서 DB의 action_payload를 직접 재조회해 검증.
// 적용 대상: PAYMENT_REQUEST_CARD(결제요청), 기타 expires_at이 있는 모든 액션카드 공통 처리.

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ActionPayload } from '$lib/types/chat'

export const POST: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // 메시지 조회
  const { data: msg, error: msgErr } = await db
    .from('chat_messages')
    .select('id, session_id, message_type, action_payload')
    .eq('id', params.id)
    .maybeSingle()

  if (msgErr || !msg) {
    return json({ error: '메시지를 찾을 수 없습니다.' }, { status: 404 })
  }

  const message = msg as {
    id: string
    session_id: string
    message_type: string
    action_payload: ActionPayload | null
  }

  // 액션카드 타입 검증
  if (message.message_type !== 'action_card' || !message.action_payload) {
    return json({ error: '액션 카드가 아닙니다.' }, { status: 400 })
  }

  // 세션 참여자 확인 (발신자 또는 수신자)
  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, admin_id')
    .eq('id', message.session_id)
    .maybeSingle()

  if (!chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { user_id: string; admin_id: string | null }
  const isParticipant =
    cs.user_id === session.user.id || cs.admin_id === session.user.id

  if (!isParticipant) {
    return json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  }

  // 서버 측 만료 재검증 — DB의 action_payload.expires_at을 직접 확인
  const payload = message.action_payload
  const isExpiredByFlag = payload.is_expired === true
  const isExpiredByTime =
    payload.expires_at != null && new Date(payload.expires_at) < new Date()

  if (isExpiredByFlag || isExpiredByTime) {
    return json(
      { error: '기한이 만료된 액션입니다.', code: 'expired' },
      { status: 410 },
    )
  }

  return json({ ok: true, action_url: payload.action_url ?? null })
}
