import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // refresh_user_segments는 호출자 확인이 없는 서버 전용 함수(Migration #698) — cms_role 검사 후 서버 권한으로만 호출한다
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  if (!profile?.cms_role) {
    return json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await admin.rpc('refresh_user_segments')

  if (error) {
    return json({ success: false, error: error.message }, { status: 500 })
  }

  return json({ success: true, ...(data as object) })
}
