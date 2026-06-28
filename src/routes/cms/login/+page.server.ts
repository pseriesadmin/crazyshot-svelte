import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (session) {
    const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
    if (profile?.cms_role) throw redirect(303, '/cms')
  }

  const inviteToken = url.searchParams.get('invite')
  if (!inviteToken) return {}

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { inviteExpired: true }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data: tokenRow } = await admin
    .from('admin_invite_tokens')
    .select('created_by, expires_at, used_at')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
    return { inviteExpired: true }
  }

  const { data: { user } } = await admin.auth.admin.getUserById(tokenRow.created_by)

  return {
    inviteMode: true,
    inviteToken,
    inviteEmail: user?.email ?? '',
  }
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

    const p = await fetchCmsProfileByAuthId(locals.supabase, data.session.user.id)
    if (!p?.cms_role) {
      await locals.supabase.auth.signOut()
      return fail(403, { error: 'CMS 접근 권한이 없습니다.' })
    }

    throw redirect(303, '/cms')
  },

  setPassword: async ({ request, locals }) => {
    const form = await request.formData()
    const token    = (form.get('token')    as string | null) ?? ''
    const password = (form.get('password') as string | null) ?? ''
    const confirm  = (form.get('confirm')  as string | null) ?? ''

    if (!password || !confirm) {
      return fail(400, { error: '비밀번호를 입력해주세요.' })
    }
    if (password.length !== confirm.length || Buffer.from(password).equals(Buffer.from(confirm)) === false) {
      return fail(400, { error: '비밀번호가 일치하지 않습니다.' })
    }
    if (password.length < 8) {
      return fail(400, { error: '비밀번호는 8자 이상이어야 합니다.' })
    }

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })

    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

    const { data: tokenRow } = await admin
      .from('admin_invite_tokens')
      .select('created_by, expires_at, used_at')
      .eq('token', token)
      .maybeSingle()

    if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
      return fail(400, { error: '초대 링크가 만료되었거나 이미 사용되었습니다.' })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(
      tokenRow.created_by,
      { password }
    )
    if (updateErr) return fail(500, { error: '비밀번호 설정에 실패했습니다.' })

    await admin
      .from('admin_invite_tokens')
      .update({ used_by: tokenRow.created_by, used_at: new Date().toISOString() })
      .eq('token', token)

    const { data: { user } } = await admin.auth.admin.getUserById(tokenRow.created_by)
    const email = user?.email ?? ''

    const { data, error: loginErr } = await locals.supabase.auth.signInWithPassword({ email, password })
    if (loginErr || !data.session) {
      return fail(500, { error: '비밀번호 설정은 완료됐습니다. 로그인 해주세요.' })
    }

    throw redirect(303, '/cms')
  },
}
