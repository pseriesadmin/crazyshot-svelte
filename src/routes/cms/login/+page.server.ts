import { fail, redirect } from '@sveltejs/kit'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return {}

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
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

    const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password })

    if (error || !data.session) {
      return fail(401, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
    }

    // RLS: user_profiles 본인 조회 (48번) — service_role 불필요
    const p = await fetchCmsProfileByAuthId(locals.supabase, data.session.user.id)
    if (!p?.cms_role) {
      await locals.supabase.auth.signOut()
      return fail(403, { error: 'CMS 접근 권한이 없습니다.' })
    }

    throw redirect(303, '/cms')
  },
}
