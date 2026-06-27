// POST /api/chat/session — 채팅 세션 생성
// PRD.1.7.6

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { CreateSessionRequest, ChatSession } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  let body: CreateSessionRequest = {}
  try {
    body = await request.json()
  } catch {
    // body 없으면 기본값 사용
  }

  const { context_type = 'general', context_id } = body
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validContextId = context_id && UUID_RE.test(context_id) ? context_id : null

  // 최근 종료된 세션이 있으면 신규 생성 대신 재활성화
  let query = db
    .from('chat_sessions')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('status', 'closed')
    .order('updated_at', { ascending: false })
    .limit(1)

  if (context_type) query = query.eq('context_type', context_type)
  if (validContextId) query = query.eq('context_id', validContextId)

  const { data: closedSession } = await query.maybeSingle()

  if (closedSession) {
    const { data: reopened, error: reopenErr } = await db
      .from('chat_sessions')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', closedSession.id)
      .select()
      .single()

    if (!reopenErr && reopened) {
      return json({ session: reopened as ChatSession }, { status: 200 })
    }
  }

  const { data, error } = await db
    .from('chat_sessions')
    .insert({
      user_id: session.user.id,
      context_type,
      context_id: validContextId,
      status: 'open',
    })
    .select()
    .single()

  if (error) {
    return json({ error: error.message }, { status: 500 })
  }

  return json({ session: data as ChatSession }, { status: 201 })
}
