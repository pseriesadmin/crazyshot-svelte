import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2)
  const masked = visible + '*'.repeat(Math.max(local.length - 2, 1))
  return `${masked}@${domain}`
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '인증 세션이 필요합니다.' }, { status: 401 })

  let phone: string
  let code: string
  try {
    const body = await request.json() as { phone?: string; code?: string }
    phone = (body.phone ?? '').replace(/[^0-9]/g, '')
    code = (body.code ?? '').trim()
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!/^010\d{8}$/.test(phone) || !code) {
    return json({ ok: false, error: '올바른 요청 값이 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // OTP 검증 — 현재 anon 세션 유저 기준
  const { data: otp, error: otpErr } = await admin
    .from('phone_otps')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('phone', phone)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .is('verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (otpErr || !otp) {
    return json({ ok: false, error: '인증번호가 올바르지 않거나 만료되었습니다.' }, { status: 400 })
  }

  // OTP 사용 처리
  await admin.from('phone_otps').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)

  // 동일 번호를 가진 다른 계정 조회 (현재 anon 유저 제외)
  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('user_id')
    .eq('phone', phone)
    .neq('user_id', session.user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (profileErr || !profile) {
    return json({ ok: false, error: '해당 번호로 가입된 계정을 찾을 수 없습니다.' }, { status: 404 })
  }

  // service_role 어드민으로 이메일 조회
  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(profile.user_id)
  if (authErr || !authUser?.user?.email) {
    return json({ ok: false, error: '이메일 정보를 가져올 수 없습니다.' }, { status: 500 })
  }

  return json({ ok: true, email: maskEmail(authUser.user.email) })
}
