// POST /api/chat/session — 채팅 세션 생성
// PRD.1.7.6

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'
import type { CreateSessionRequest, ChatSession } from '$lib/types/chat'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // chat_sessions UPDATE RLS는 admin_update_session(is_cms_user()) 하나뿐 — 일반 고객
  // (비 CMS 직원) 세션의 closed→open 재활성화 UPDATE는 db로는 항상 조용히 막혀(0행) reopenErr가
  // 발생하고, 그 결과 기존 세션을 재사용하지 않고 매번 새 세션을 만들게 됨(정책 위반). 반드시
  // service_role로 수행해야 함.
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = serviceRoleKey ? createClient(getSupabaseUrl(), serviceRoleKey) : db

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
    const { data: reopened, error: reopenErr } = await admin
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
