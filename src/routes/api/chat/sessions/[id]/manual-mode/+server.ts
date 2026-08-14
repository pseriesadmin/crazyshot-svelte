// PATCH /api/chat/sessions/[id]/manual-mode — 세션별 자동응답 수동전환 토글
// GSD-8: P3-1 — 세션 담당 권한선 = 기존 세션 열람 권한과 동일 (manager 게이트 없음)
// RPC: set_chat_session_manual_mode

import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const PATCH = async ({ params, request, locals }: RequestEvent<{ id: string }>) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json() as { manual_mode: boolean }
  if (typeof body.manual_mode !== 'boolean') {
    return json({ error: 'manual_mode(boolean) 필수입니다.' }, { status: 400 })
  }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { error } = await admin.rpc('set_chat_session_manual_mode', {
    p_session_id: params.id,
    p_manual_mode: body.manual_mode,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ session_id: params.id, manual_mode: body.manual_mode })
}
