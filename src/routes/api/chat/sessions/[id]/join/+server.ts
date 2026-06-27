// POST /api/chat/sessions/[id]/join — 관리자가 세션 선택 시 admin_id 배정
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, locals }) => {
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

  // 세션 조회
  const { data: existing, error: fetchErr } = await admin
    .from('chat_sessions')
    .select('id, admin_id')
    .eq('id', params.id)
    .single()

  if (fetchErr || !existing) return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })

  // 이미 다른 관리자가 배정된 경우 유지
  const ex = existing as { id: string; admin_id: string | null }
  if (ex.admin_id && ex.admin_id !== session.user.id) {
    return json({ session: existing })
  }

  const { data, error } = await admin
    .from('chat_sessions')
    .update({ admin_id: session.user.id })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ session: data })
}
