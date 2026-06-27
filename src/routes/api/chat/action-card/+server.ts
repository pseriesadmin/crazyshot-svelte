// POST /api/chat/action-card — 관리자 액션 카드 수동 발송
// PRD.1.7.5 / PRD.1.7.6

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { SendActionCardRequest, ChatMessage } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // 관리자 권한 확인
  const { data: profile } = await db
    .from('user_profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .single()

  if (!profile?.is_admin) {
    return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const body: SendActionCardRequest = await request.json()

  if (!body.session_id || !body.action_payload) {
    return json({ error: 'session_id, action_payload 필수입니다.' }, { status: 400 })
  }

  // 만료 여부 초기화
  const payload = { ...body.action_payload, is_expired: false }

  const { data, error } = await db
    .from('chat_messages')
    .insert({
      session_id: body.session_id,
      sender_type: 'admin',
      content: body.content ?? null,
      message_type: 'action_card',
      action_payload: payload,
    })
    .select()
    .single()

  if (error) {
    return json({ error: error.message }, { status: 500 })
  }

  return json({ message: data as ChatMessage }, { status: 201 })
}
