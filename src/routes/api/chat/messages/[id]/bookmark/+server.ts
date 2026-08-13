// POST /api/chat/messages/[id]/bookmark — 북마크 추가/해제 (토글, idempotent)
// DELETE /api/chat/messages/[id]/bookmark — 명시적 북마크 해제 (항상 삭제)
// GSD-12: P3-2 — RPC toggle_message_bookmark 호출
// L2 QA Fix: DELETE 핸들러가 POST와 동일한 toggle RPC를 호출하던 버그 수정
//            DELETE는 명시적 삭제 (toggle이 아닌 직접 DELETE FROM)

import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const POST = async ({ params, request, locals }: RequestEvent<{ id: string }>) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json().catch(() => ({})) as { session_id?: string; note?: string }
  if (!body.session_id) return json({ error: 'session_id 필수입니다.' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('toggle_message_bookmark', {
    p_message_id: params.id,
    p_session_id: body.session_id,
    p_admin_id:   session.user.id,
    p_note:       body.note ?? null,
  })

  if (error) return json({ error: error.message }, { status: 500 })
  return json(data)
}

export const DELETE = async ({ params, locals }: RequestEvent<{ id: string }>) => {
  // L2 QA Fix: 명시적 DELETE — toggle이 아닌 직접 삭제 (H-01 예외: 단순 삭제 DML)
  // chat_message_bookmarks는 단순 보조 데이터 (예약·결제 같은 핵심 도메인 아님)
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { error } = await admin
    .from('chat_message_bookmarks')
    .delete()
    .eq('message_id', params.id)
    .eq('admin_id', session.user.id)

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ deleted: true })
}
