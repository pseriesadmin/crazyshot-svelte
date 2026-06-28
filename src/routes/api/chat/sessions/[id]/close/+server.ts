// POST /api/chat/sessions/[id]/close — 관리자: 채팅 세션 종료
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, locals }) => {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('chat_sessions')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .in('status', ['open', 'pending'])
    .select('id, status')
    .single()

  const err = error as { code?: string; message?: string } | null
  // PGRST116 = 0 rows matched (이미 closed거나 존재하지 않는 세션)
  if (err?.code === 'PGRST116' || !data) {
    return json({ error: '세션을 찾을 수 없거나 이미 종료됐습니다.' }, { status: 404 })
  }
  if (err) return json({ error: err.message }, { status: 500 })

  return json({ session: data })
}
