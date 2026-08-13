// POST /api/chat/sessions/[id]/pending — 관리자: 진행중 세션을 대기(pending)로 전환
// GSD-2: P1-3 상태 직접변경 버튼 — pending
// M2 QA Fix: H-01 준수 — 직접 UPDATE 제거, set_chat_session_status RPC 경유

import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'

export const POST = async ({ params, locals }: RequestEvent<{ id: string }>) => {
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

  // M2 QA Fix: H-01 준수 — set_chat_session_status RPC 경유 (직접 UPDATE 금지)
  // RPC가 idempotent 처리 + 세션 미존재 예외를 내부 처리함
  const { data, error } = await admin.rpc('set_chat_session_status', {
    p_session_id: sessionId,
    p_status:     'pending',
  })

  const rpcErr = error as { code?: string; message?: string } | null
  if (rpcErr) {
    if (rpcErr.message?.includes('찾을 수 없습니다')) {
      return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
    }
    return json({ error: rpcErr.message }, { status: 500 })
  }

  const result = data as { session_id: string; old_status: string; new_status: string; changed: boolean } | null
  return json({ session: { id: sessionId, status: result?.new_status ?? 'pending' } })
}
