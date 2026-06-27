// POST /api/chat/attachment — 파일 첨부 메시지 저장 (AI 분류 없음)
// PRD.1.7

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ChatMessage } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  const body: { session_id: string; file_name: string; file_url: string; is_image: boolean } =
    await request.json()

  if (!body.session_id || !body.file_url) {
    return json({ error: 'session_id, file_url 필수입니다.' }, { status: 400 })
  }

  // 세션 소유자 확인
  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, status')
    .eq('id', body.session_id)
    .single()

  if (!chatSession || chatSession.user_id !== session.user.id) {
    return json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  if (chatSession.status === 'closed') {
    return json({ error: '종료된 세션입니다.' }, { status: 400 })
  }

  // content 형식: "파일명\n파일URL"
  const content = `${body.file_name}\n${body.file_url}`

  const { data: message, error } = await db
    .from('chat_messages')
    .insert({
      session_id: body.session_id,
      sender_type: 'user',
      content,
      message_type: body.is_image ? 'image' : 'text',
    })
    .select()
    .single()

  if (error || !message) {
    return json({ error: error?.message ?? '저장 실패' }, { status: 500 })
  }

  // session updated_at 갱신
  await db
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', body.session_id)

  return json({ message: message as ChatMessage }, { status: 201 })
}
