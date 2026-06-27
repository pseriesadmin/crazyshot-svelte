// DELETE /api/chat/message/[id] — 사용자 첨부 메시지 삭제
// PRD.1.7 — 본인 메시지만 삭제 가능

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // 메시지 소유자 확인 (세션의 user_id 경유)
  const { data: msg } = await db
    .from('chat_messages')
    .select('id, session_id, sender_type, message_type')
    .eq('id', params.id)
    .single()

  if (!msg) return json({ error: '메시지를 찾을 수 없습니다.' }, { status: 404 })
  if (msg.sender_type !== 'user') return json({ error: '삭제 권한이 없습니다.' }, { status: 403 })

  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id')
    .eq('id', msg.session_id)
    .single()

  if (!chatSession || chatSession.user_id !== session.user.id) {
    return json({ error: '삭제 권한이 없습니다.' }, { status: 403 })
  }

  const { error } = await db.from('chat_messages').delete().eq('id', params.id)

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ ok: true })
}
