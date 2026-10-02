// POST /api/chat/attachment — 파일 첨부 메시지 저장 (AI 분류 없음)
// PRD.1.7

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { validateChatAttachmentInput } from '$lib/server/chatAttachmentValidation'
import type { RequestHandler } from './$types'
import type { ChatMessage } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // 입력 검증 — 잘못된 JSON·타입은 500이 아니라 400, 첨부 URL은 이 세션의 chat-attachments 업로드 경로만 허용
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const parsed = validateChatAttachmentInput(rawBody, getSupabaseUrl())
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })
  const body = parsed.value

  // 세션 소유자 확인
  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, status')
    .eq('id', body.session_id)
    .single()

  if (!chatSession || chatSession.user_id !== session.user.id) {
    return json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  // 종료·대기 세션에 새 메시지가 오면 텍스트 메시지(/api/chat/message)와 똑같이 진행중(open)으로 복귀한다
  // (service-operations.md §7·§13 ①). chat_sessions UPDATE RLS는 CMS 직원 전용이라 고객 클라이언트로는 조용히 무시되므로 service_role로 수행.
  if (chatSession.status !== 'open') {
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      if (chatSession.status === 'closed') return json({ error: '종료된 세션입니다.' }, { status: 400 })
    } else {
      const admin = createClient(getSupabaseUrl(), serviceRoleKey)
      await admin
        .from('chat_sessions')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', body.session_id)
    }
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
