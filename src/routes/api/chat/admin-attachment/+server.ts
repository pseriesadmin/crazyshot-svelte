// POST /api/chat/admin-attachment — 관리자 파일 첨부 메시지 저장
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import type { ChatMessage } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  // cms_role 확인 (service role — user_profiles RLS bypass)
  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const p = profile as { cms_role: string | null } | null
  if (!p?.cms_role) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const sessionId = (body?.session_id as string | undefined)?.trim() ?? ''
  const fileName  = (body?.file_name  as string | undefined)?.trim() ?? ''
  const fileUrl   = (body?.file_url   as string | undefined)?.trim() ?? ''
  const isImage   = Boolean(body?.is_image)

  if (!sessionId || !fileUrl) {
    return json({ error: 'session_id와 file_url은 필수입니다.' }, { status: 400 })
  }

  // 세션 확인
  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { id: string; status: string }
  // 관리자 첨부 → closed/pending 모두 open으로 복구 (admin-reply와 동일 정책)
  if (cs.status === 'closed' || cs.status === 'pending') {
    await admin
      .from('chat_sessions')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  // content: "파일명\nURL" 형식 (MessageBubble이 파싱)
  const content = fileName ? `${fileName}\n${fileUrl}` : fileUrl

  const { data: message, error: insertErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:   sessionId,
      sender_type:  'admin',
      content,
      message_type: isImage ? 'image' : 'text',
      is_read:      false,
    })
    .select()
    .single()

  if (insertErr) return json({ error: insertErr.message }, { status: 500 })

  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return json({ message: message as ChatMessage }, { status: 201 })
}
