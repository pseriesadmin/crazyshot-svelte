import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { sendSms } from '$lib/server/sms'
import type { Actions, PageServerLoad } from './$types'

// ── 비밀번호 재설정 링크(복구) 관련 상수·헬퍼 ──────────────────
// admin_password_recovery_tokens 전용 — admin_invite_tokens(신규 계정 최초 설정용)와
// 완전히 분리된 흐름이다(Migration #504, 2026-09-15).
const RECOVERY_MAX_MATCH_ATTEMPTS = 5
const RECOVERY_MAX_OTP_ATTEMPTS = 5

interface RecoveryTokenRow {
  id: string
  target_user_id: string
  used_at: string | null
  locked_at: string | null
  expires_at: string
  email_verified_at: string | null
  phone_verified_at: string | null
  otp_code: string | null
  otp_expires_at: string | null
  otp_attempts: number
  match_attempts: number
}

async function loadValidRecoveryToken(
  admin: SupabaseClient,
  token: string
): Promise<{ row: RecoveryTokenRow } | { error: string }> {
  const { data } = await admin
    .from('admin_password_recovery_tokens')
    .select(
      'id, target_user_id, used_at, locked_at, expires_at, email_verified_at, phone_verified_at, otp_code, otp_expires_at, otp_attempts, match_attempts'
    )
    .eq('token', token)
    .maybeSingle()

  const row = data as RecoveryTokenRow | null
  if (!row) return { error: '유효하지 않은 링크입니다.' }
  if (row.locked_at) return { error: '보안을 위해 이 링크는 차단되었습니다. 관리자에게 새 링크를 요청해주세요.' }
  if (row.used_at) return { error: '이미 사용된 링크입니다.' }
  if (new Date(row.expires_at) < new Date()) return { error: '링크가 만료되었습니다. 관리자에게 새 링크를 요청해주세요.' }
  return { row }
}

async function registerRecoveryMismatch(admin: SupabaseClient, row: RecoveryTokenRow): Promise<void> {
  const next = row.match_attempts + 1
  const patch: Record<string, unknown> = { match_attempts: next }
  if (next >= RECOVERY_MAX_MATCH_ATTEMPTS) patch.locked_at = new Date().toISOString()
  await admin.from('admin_password_recovery_tokens').update(patch).eq('id', row.id)
}

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

  // ── 비밀번호 재설정("복구") 링크 진입 — admin_invite_tokens와 별개 흐름 ──
  const recoverToken = url.searchParams.get('recover')
  if (recoverToken) {
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return { recoverStatus: 'invalid' as const, logoutType, logoutTime, returnTo, clientIp }

    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
    const result = await loadValidRecoveryToken(admin, recoverToken)

    if ('error' in result) {
      return { recoverStatus: 'invalid' as const, recoverError: result.error, logoutType, logoutTime, returnTo, clientIp }
    }

    const { row } = result
    const recoverStep = !row.email_verified_at ? 'email' : !row.phone_verified_at ? 'phone' : 'password'
    return {
      recoverStatus: 'valid' as const,
      recoverToken,
      recoverStep,
      logoutType, logoutTime, returnTo, clientIp,
    }
  }

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

  // ── 비밀번호 재설정("복구") 링크 — 1단계: 등록 이메일 일치 확인 ──
  verifyRecoveryEmail: async ({ request }) => {
    const form = await request.formData()
    const token = (form.get('token') as string | null) ?? ''
    const email = ((form.get('email') as string | null) ?? '').trim().toLowerCase()
    if (!token) return fail(400, { error: '잘못된 요청입니다.' })
    if (!email) return fail(400, { error: '이메일을 입력해주세요.' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })
    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

    const result = await loadValidRecoveryToken(admin, token)
    if ('error' in result) return fail(400, { error: result.error })
    const { row } = result
    if (row.email_verified_at) return { success: true }

    const { data: { user } } = await admin.auth.admin.getUserById(row.target_user_id)
    const targetEmail = (user?.email ?? '').trim().toLowerCase()

    if (!targetEmail || targetEmail !== email) {
      await registerRecoveryMismatch(admin, row)
      return fail(400, { error: '입력하신 정보가 등록된 정보와 일치하지 않습니다.' })
    }

    await admin
      .from('admin_password_recovery_tokens')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', row.id)

    return { success: true }
  },

  // ── 비밀번호 재설정("복구") 링크 — 2단계: 등록 휴대폰 일치 확인 + OTP 발송 ──
  sendRecoveryPhoneOtp: async ({ request }) => {
    const form = await request.formData()
    const token = (form.get('token') as string | null) ?? ''
    const phone = ((form.get('phone') as string | null) ?? '').replace(/[^0-9]/g, '')
    if (!token) return fail(400, { error: '잘못된 요청입니다.' })
    if (!/^010\d{8}$/.test(phone)) {
      return fail(400, { error: '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)' })
    }

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })
    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

    const result = await loadValidRecoveryToken(admin, token)
    if ('error' in result) return fail(400, { error: result.error })
    const { row } = result
    if (!row.email_verified_at) return fail(400, { error: '이메일 인증을 먼저 완료해주세요.' })

    const { data: profile } = await admin
      .from('user_profiles')
      .select('phone')
      .eq('id', row.target_user_id)
      .maybeSingle()
    const targetPhone = ((profile as { phone: string | null } | null)?.phone ?? '').replace(/[^0-9]/g, '')

    if (!targetPhone || targetPhone !== phone) {
      await registerRecoveryMismatch(admin, row)
      return fail(400, { error: '입력하신 정보가 등록된 정보와 일치하지 않습니다.' })
    }

    // ⛔ 재발송 시 otp_attempts를 리셋하지 않는다 — 리셋하면 "5회 오입력 시 링크 잠금"
    // 방어가 재발송을 반복하는 것만으로 무력화된다(GATE E 검수에서 발견, 2026-09-15).
    // 오입력 카운터는 오직 verifyRecoveryPhoneOtp에서만 증가·판정하며, 이미 5회에
    // 도달해 locked_at이 찍힌 토큰은 loadValidRecoveryToken이 이 지점에서 먼저 차단한다.
    if (row.otp_attempts >= RECOVERY_MAX_OTP_ATTEMPTS) {
      await admin
        .from('admin_password_recovery_tokens')
        .update({ locked_at: new Date().toISOString() })
        .eq('id', row.id)
      return fail(400, { error: '보안을 위해 이 링크는 차단되었습니다. 관리자에게 새 링크를 요청해주세요.' })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const otpExpiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString()
    await admin
      .from('admin_password_recovery_tokens')
      .update({ otp_code: code, otp_expires_at: otpExpiresAt })
      .eq('id', row.id)

    // ⛔ dev 우회 없음 — 관리자 계정 탈취 방지용 본인확인 OTP이므로 로컬 환경에서도
    // 항상 실제 SMS를 발송한다(회원가입·내정보 OTP와 동일 원칙, Stephen 2026-09-11 확정).
    try {
      await sendSms(phone, `[CRAZYSHOT.KR CMS] 계정 복구 인증번호 [${code}]를 화면에 입력해주세요. (유효시간 3분)`)
    } catch {
      return fail(500, { error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' })
    }
    return { success: true }
  },

  // ── 비밀번호 재설정("복구") 링크 — 3단계: OTP 인증번호 확인 ──
  verifyRecoveryPhoneOtp: async ({ request }) => {
    const form = await request.formData()
    const token = (form.get('token') as string | null) ?? ''
    const code = ((form.get('code') as string | null) ?? '').trim()
    if (!token) return fail(400, { error: '잘못된 요청입니다.' })
    if (!code) return fail(400, { error: '인증번호를 입력해주세요.' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })
    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

    const result = await loadValidRecoveryToken(admin, token)
    if ('error' in result) return fail(400, { error: result.error })
    const { row } = result
    if (!row.email_verified_at) return fail(400, { error: '이메일 인증을 먼저 완료해주세요.' })
    if (!row.otp_code || !row.otp_expires_at) return fail(400, { error: '인증번호를 먼저 요청해주세요.' })
    if (new Date(row.otp_expires_at) < new Date()) {
      return fail(400, { error: '인증번호가 만료되었습니다. 다시 요청해주세요.' })
    }

    if (row.otp_code !== code) {
      const nextAttempts = row.otp_attempts + 1
      const patch: Record<string, unknown> = { otp_attempts: nextAttempts }
      if (nextAttempts >= RECOVERY_MAX_OTP_ATTEMPTS) patch.locked_at = new Date().toISOString()
      await admin.from('admin_password_recovery_tokens').update(patch).eq('id', row.id)
      return fail(400, { error: '인증번호가 올바르지 않습니다.' })
    }

    await admin
      .from('admin_password_recovery_tokens')
      .update({ phone_verified_at: new Date().toISOString() })
      .eq('id', row.id)

    return { success: true }
  },

  // ── 비밀번호 재설정("복구") 링크 — 4단계: 새 비밀번호 설정 + 자동 로그인 ──
  setRecoveryPassword: async ({ request, locals }) => {
    const form = await request.formData()
    const token = (form.get('token') as string | null) ?? ''
    const password = (form.get('password') as string | null) ?? ''
    const confirm = (form.get('confirm') as string | null) ?? ''
    if (!token) return fail(400, { error: '잘못된 요청입니다.' })
    if (!password || !confirm) return fail(400, { error: '비밀번호를 입력해주세요.' })
    if (password.length !== confirm.length || Buffer.from(password).equals(Buffer.from(confirm)) === false) {
      return fail(400, { error: '비밀번호가 일치하지 않습니다.' })
    }
    if (password.length < 8) return fail(400, { error: '비밀번호는 8자 이상이어야 합니다.' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })
    const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

    const result = await loadValidRecoveryToken(admin, token)
    if ('error' in result) return fail(400, { error: result.error })
    const { row } = result
    if (!row.email_verified_at || !row.phone_verified_at) {
      return fail(400, { error: '본인확인을 먼저 완료해주세요.' })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(row.target_user_id, { password })
    if (updateErr) return fail(500, { error: '비밀번호 설정에 실패했습니다.' })

    await admin
      .from('admin_password_recovery_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', row.id)

    await insertCmsAdminAuditLog(admin, {
      actorId: row.target_user_id,
      actionType: 'password_recovery_completed',
      targetUserId: row.target_user_id,
    })

    const { data: { user } } = await admin.auth.admin.getUserById(row.target_user_id)
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
