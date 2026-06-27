// POST /api/chat/admin-reply — 관리자 메시지 전송
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

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
  const content   = (body?.content   as string | undefined)?.trim() ?? ''

  if (!sessionId || !content) {
    return json({ error: 'session_id와 content는 필수입니다.' }, { status: 400 })
  }

  // 세션 확인
  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, admin_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { id: string; admin_id: string | null; status: string }

  // 관리자 메시지 → 항상 '진행중'(open)으로 복구
  // closed: 종료 → 재개 / pending: 대기 → 진행중
  if (cs.status === 'closed' || cs.status === 'pending') {
    await admin
      .from('chat_sessions')
      .update({
        status: 'open',
        admin_id: cs.admin_id ?? session.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
  } else if (!cs.admin_id) {
    // 이미 open 상태: admin_id 미배정이면 배정
    await admin
      .from('chat_sessions')
      .update({ admin_id: session.user.id })
      .eq('id', sessionId)
  }

  // 메시지 저장
  const { data: message, error: insertErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:   sessionId,
      sender_type:  'admin',
      content,
      message_type: 'text',
      is_read:      false,
    })
    .select()
    .single()

  if (insertErr) return json({ error: insertErr.message }, { status: 500 })

  // updated_at 갱신
  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return json({ message })
}
