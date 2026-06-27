// POST /api/chat/close — 세션 종료 + cs_records 저장
// PRD.1.7.6

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  const body: { session_id: string; summary?: string; category?: string } =
    await request.json()

  if (!body.session_id) {
    return json({ error: 'session_id 필수입니다.' }, { status: 400 })
  }

  // 세션 소유자 확인
  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, admin_id')
    .eq('id', body.session_id)
    .single()

  if (
    chatSession?.user_id !== session.user.id &&
    chatSession?.admin_id !== session.user.id
  ) {
    return json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  // 세션 closed 처리
  const { error: closeError } = await db
    .from('chat_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', body.session_id)

  if (closeError) {
    return json({ error: closeError.message }, { status: 500 })
  }

  // cs_records 저장 (summary 있을 때만)
  if (body.summary) {
    await db.from('cs_records').insert({
      session_id: body.session_id,
      user_id: chatSession.user_id,
      category: body.category ?? null,
      summary: body.summary,
      status: 'resolved',
    })
  }

  return json({ success: true })
}
