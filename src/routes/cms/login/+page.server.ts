import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return {}

  // service role로 cms_role 확인 (user_profiles RLS 정책 없음)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return {}

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
  const { data } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const profile = data as { cms_role: string | null } | null
  if (profile?.cms_role) throw redirect(303, '/cms')
  return {}
}

export const actions: Actions = {
  login: async ({ request, locals }) => {
    const form = await request.formData()
    const email    = (form.get('email')    as string | null)?.trim() ?? ''
    const password = (form.get('password') as string | null) ?? ''

    if (!email || !password) {
      return fail(400, { error: '이메일과 비밀번호를 입력해주세요.' })
    }

    // 1. Supabase 로그인
    const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password })

    if (error || !data.session) {
      return fail(401, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
    }

    // 2. service role로 cms_role 확인 (RLS bypass)
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return fail(500, { error: '서버 설정 오류입니다.' })
    }

    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
    const { data: profile } = await admin
      .from('user_profiles')
      .select('cms_role')
      .eq('id', data.session.user.id)
      .single()

    const p = profile as { cms_role: string | null } | null
    if (!p?.cms_role) {
      await locals.supabase.auth.signOut()
      return fail(403, { error: 'CMS 접근 권한이 없습니다.' })
    }

    throw redirect(303, '/cms')
  },
}
