import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { pickFindableProfile, type FindEmailProfileRow } from '$lib/server/findEmailMatch'

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
  let name: string
  try {
    const body = await request.json() as { phone?: string; code?: string; name?: string }
    phone = (body.phone ?? '').replace(/[^0-9]/g, '')
    code = (body.code ?? '').trim()
    name = (typeof body.name === 'string' ? body.name : '').trim()
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!/^010\d{8}$/.test(phone) || !code || name.length < 2 || name.length > 50) {
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
    // 틀린 인증번호 입력 시 이 세션·번호의 미사용 인증번호를 폐기 — 6자리 반복 대입 방지(재발송 필요)
    await admin.from('phone_otps').update({ expires_at: new Date().toISOString() }).eq('user_id', session.user.id).eq('phone', phone).is('verified_at', null)
    return json({ ok: false, error: '인증번호가 올바르지 않거나 만료되었습니다.' }, { status: 400 })
  }

  // OTP 사용 처리
  await admin.from('phone_otps').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)

  // 동일 번호를 가진 다른 계정 조회 (현재 anon 유저 제외)
  // 프로필의 휴대폰은 "01012345678"과 "010-1234-5678" 두 형식이 섞여 저장돼 있다 — 둘 다 같은 번호로 본다
  const hyphenated = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
  const { data: profiles, error: profileErr } = await admin
    .from('user_profiles')
    .select('user_id, full_name, cms_role, withdrawal_status, email')
    .in('phone', [phone, hyphenated])
    .neq('user_id', session.user.id)
    .is('deleted_at', null)
    .limit(2)
  // 같은 번호에 계정이 둘 이상이거나 관리자·탈회 삭제 계정이면 진행하지 않는다. 번호 미가입과 이름 불일치는 같은 문구로 돌려
  // 가입 여부·이름을 추측할 단서를 주지 않는다(공백·대소문자 무시 비교).
  const profile = profileErr ? null : pickFindableProfile((profiles ?? []) as FindEmailProfileRow[], name)
  if (!profile) {
    return json({ ok: false, error: '입력하신 이름과 휴대폰 정보가 일치하는 계정을 찾을 수 없습니다.' }, { status: 404 })
  }

  // service_role 어드민으로 이메일 조회
  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(profile.user_id)
  if (authErr || !authUser?.user?.email) {
    return json({ ok: false, error: '이메일 정보를 가져올 수 없습니다.' }, { status: 500 })
  }

  return json({ ok: true, email: maskEmail(authUser.user.email) })
}
