// GET /api/chat/sessions — 관리자 전체 세션 목록
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, locals }) => {
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

  // 1시간 이상 비활성 open 세션 → pending 자동 전환 (호출 시마다 실행)
  await admin.rpc('auto_pending_inactive_sessions')

  const status = url.searchParams.get('status')

  let query = admin
    .from('chat_sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) return json({ error: error.message }, { status: 500 })

  const rows = data ?? []

  // 세션별 마지막 메시지 조회 — 세션마다 최신 1건 (closed 포함 모든 세션 정확히 처리)
  const sessionIds = rows.map((s: Record<string, unknown>) => s.id as string)
  const lastMsgMap: Record<string, { content: string | null; sender_type: string }> = {}

  if (sessionIds.length > 0) {
    const results = await Promise.all(
      sessionIds.map((id) =>
        admin
          .from('chat_messages')
          .select('session_id, content, sender_type')
          .eq('session_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    )

    for (const { data } of results) {
      const m = data as { session_id: string; content: string | null; sender_type: string } | null
      if (m) lastMsgMap[m.session_id] = { content: m.content, sender_type: m.sender_type }
    }
  }

  const sessions = rows.map((s: Record<string, unknown>) => ({
    ...s,
    user_name: '',
    user_handle: '',
    last_message_content: lastMsgMap[s.id as string]?.content ?? '',
    last_message_sender: lastMsgMap[s.id as string]?.sender_type ?? '',
  }))

  return json({ sessions })
}
