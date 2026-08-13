// GET /api/chat/sessions/[id]/bookmarks — 세션별 북마크 목록 조회
// GSD-14: P3-2 — get_session_bookmarks RPC 호출

import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET = async ({ params, locals }: RequestEvent<{ id: string }>) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('get_session_bookmarks', {
    p_admin_id:   session.user.id,
    p_session_id: params.id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ bookmarks: data ?? [] })
}
