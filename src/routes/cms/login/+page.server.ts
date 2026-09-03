import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url, getClientAddress }) => {
  const { session } = await locals.safeGetSession()
  if (session) {
    const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
    if (profile?.cms_role) throw redirect(303, '/cms')
  }

  const logoutType = url.searchParams.get('logout') as 'manual' | 'expired' | null
  const logoutTime = url.searchParams.get('t') ?? null
  // /cms/mobile 진입 후 로그인 시 원래 경로로 복귀
  const returnTo = url.searchParams.get('returnTo') ?? null

  let clientIp = 'unknown'
  try { clientIp = getClientAddress() } catch { /* dev 환경에서 무시 */ }

  const inviteToken = url.searchParams.get('invite')
  if (!inviteToken) return { logoutType, logoutTime, returnTo, clientIp }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { inviteExpired: true }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data: tokenRow } = await admin
    .from('admin_invite_tokens')
    .select('created_by, expires_at, used_at')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
    return { inviteExpired: true, logoutType, logoutTime, returnTo }
  }

  const { data: { user } } = await admin.auth.admin.getUserById(tokenRow.created_by)

  return {
    inviteMode: true,
    inviteToken,
    inviteEmail: user?.email ?? '',
    logoutType,
    logoutTime,
    returnTo,
    clientIp,
  }
}

export const actions: Actions = {
  login: async ({ request, locals, cookies, getClientAddress }) => {
    const form = await request.formData()
    const email      = (form.get('email')      as string | null)?.trim() ?? ''
    const password   = (form.get('password')   as string | null) ?? ''
    const rememberMe = form.get('rememberMe') === 'on'

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

    // 로그인 로그 저장 (보안 강화 — 실패해도 로그인 차단 안 함)
    try {
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceRoleKey) {
        const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
        let ip = 'unknown'
        try { ip = getClientAddress() } catch { /* dev 환경 */ }
        await admin.from('cms_login_logs').insert({
          user_id:      data.session.user.id,
          email:        data.session.user.email ?? email,
          cms_role:     p.cms_role,
          ip_address:   request.headers.get('x-forwarded-for') ?? ip,
          user_agent:   request.headers.get('user-agent') ?? 'unknown',
          logged_in_at: new Date().toISOString(),
        })
      }
    } catch { /* 로그 저장 실패는 무시 */ }

    // 로그인 상태 유지 쿠키 설정
    // rememberMe=true  → maxAge 30일 (브라우저 종료 후에도 유지)
    // rememberMe=false → 세션 쿠키 (브라우저 종료 시 삭제)
    const cookieOpts = {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: true,
      ...(rememberMe ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    }
    cookies.set('cms-remember', '1', cookieOpts)

    // 로그인 후 원래 경로(/cms/mobile/*)로 복귀 — 그 외 경로는 /cms로
    const redirectTo = (form.get('redirectTo') as string | null)?.trim() ?? ''
    const safePath = redirectTo.startsWith('/cms/mobile') ? redirectTo : '/cms'
    throw redirect(303, safePath)
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

  changePassword: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증이 필요합니다.' })

    const email = session.user.email
    if (!email) return fail(400, { error: '계정 정보를 확인할 수 없습니다.' })

    const form = await request.formData()
    const currentPassword = (form.get('currentPassword') as string | null) ?? ''
    const newPassword     = (form.get('newPassword')     as string | null) ?? ''
    const confirmPassword = (form.get('confirmPassword') as string | null) ?? ''

    if (!currentPassword || !newPassword || !confirmPassword) {
      return fail(400, { error: '모든 항목을 입력해주세요.' })
    }
    if (
      newPassword.length !== confirmPassword.length ||
      Buffer.from(newPassword).equals(Buffer.from(confirmPassword)) === false
    ) {
      return fail(400, { error: '새 비밀번호가 일치하지 않습니다.' })
    }
    if (newPassword.length < 8) {
      return fail(400, { error: '새 비밀번호는 8자 이상이어야 합니다.' })
    }

    // 현재 비밀번호 재확인(재인증) — 세션이 살아있어도 실제 비밀번호를 아는지 확인
    const { error: verifyErr } = await locals.supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (verifyErr) return fail(400, { error: '현재 비밀번호가 올바르지 않습니다.' })

    const { error: updateErr } = await locals.supabase.auth.updateUser({ password: newPassword })
    if (updateErr) return fail(500, { error: '비밀번호 변경에 실패했습니다.' })

    return { success: true }
  },
}
