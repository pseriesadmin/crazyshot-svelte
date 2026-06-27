// DELETE /api/chat/sessions/[id] — 세션 완전 삭제 (closed 전용, 관리자)
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // cms_role 확인
  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const p = profile as { cms_role: string | null } | null
  if (!p?.cms_role) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const sessionId = params.id

  // closed 상태인지 확인 (closed 세션만 완전 삭제 허용)
  const { data: chatSession } = await admin
    .from('chat_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single()

  const cs = chatSession as { id: string; status: string } | null
  if (!cs) return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  if (cs.status !== 'closed') {
    return json({ error: '종료된 세션만 완전 삭제할 수 있습니다.' }, { status: 400 })
  }

  // 1. chat_intent_logs 삭제 (message_id 참조 → 먼저 삭제)
  const { data: msgIds } = await admin
    .from('chat_messages')
    .select('id')
    .eq('session_id', sessionId)

  const ids = (msgIds ?? []).map((m: { id: string }) => m.id)
  if (ids.length > 0) {
    await admin.from('chat_intent_logs').delete().in('message_id', ids)
  }

  // 2. chat_messages 삭제
  await admin.from('chat_messages').delete().eq('session_id', sessionId)

  // 3. cs_records 삭제
  await admin.from('cs_records').delete().eq('session_id', sessionId)

  // 4. chat_sessions 삭제
  const { error } = await admin.from('chat_sessions').delete().eq('id', sessionId)

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ success: true })
}
