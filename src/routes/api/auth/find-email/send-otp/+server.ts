import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { dev } from '$app/environment'
import { sendSms } from '$lib/server/sms'
import { generateOtpCode } from '$lib/server/otpCode'
import { pickFindableProfile, type FindEmailProfileRow } from '$lib/server/findEmailMatch'
import { normalizePhone, PHONE_RE, RESEND_COOLDOWN_MS, MAX_SENDS_PER_HOUR } from '$lib/server/passwordResetOtp'

// 아이디 찾기 — 이름 + 휴대폰이 같은 일반 고객 계정일 때만 인증번호를 문자로 보낸다(비밀번호 찾기 send-otp와 같은 방식).
// 인증번호는 find-email 이 읽는 phone_otps(현재 세션 사용자 기준)에 저장한다 — 비밀번호 재설정(password_reset_otps)과 섞이지 않는다.
// 번호 미가입·이름 불일치·관리자 계정·모호한 중복은 같은 문구로 돌려 가입 여부를 추측할 단서를 주지 않는다.
const NO_MATCH_MSG = '입력하신 이름과 휴대폰 정보가 일치하는 계정을 찾을 수 없어요.'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '인증 세션이 필요합니다.' }, { status: 401 })

  let phone: string
  let name: string
  try {
    const body = await request.json() as { phone?: string; name?: string }
    phone = normalizePhone(body.phone)
    name = (typeof body.name === 'string' ? body.name : '').trim()
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }
  if (!PHONE_RE.test(phone) || name.length < 2 || name.length > 50) {
    return json({ ok: false, error: '올바른 요청 값이 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 발송 한도(번호 기준 — 세션을 새로 만들어도 우회되지 않게 사용자와 무관하게 센다)
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentErr } = await admin
    .from('phone_otps')
    .select('created_at')
    .eq('phone', phone)
    .gt('created_at', hourAgo)
    .order('created_at', { ascending: false })
    .limit(MAX_SENDS_PER_HOUR)
  if (recentErr) {
    console.error('[find-email/send-otp] 발송 이력 조회 실패:', recentErr.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const recentRows = (recent ?? []) as { created_at: string }[]
  if (recentRows.length >= MAX_SENDS_PER_HOUR) {
    return json({ ok: false, error: '인증번호 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })
  }
  if (recentRows[0]) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - new Date(recentRows[0].created_at).getTime())
    if (waitMs > 0) {
      return json({ ok: false, error: `${Math.ceil(waitMs / 1000)}초 후 다시 시도해 주세요.` }, { status: 429 })
    }
  }

  // 일치 계정 확인 — find-email 과 같은 규칙(현재 익명 세션 제외·삭제 제외·정확히 1건·이름 비교)에 관리자·탈회 완전삭제 제외를 더한다
  const hyphenated = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
  const { data: profiles, error: profileErr } = await admin
    .from('user_profiles')
    .select('user_id, full_name, cms_role, withdrawal_status, email')
    .in('phone', [phone, hyphenated])
    .neq('user_id', session.user.id)
    .is('deleted_at', null)
    .limit(2)
  if (profileErr) {
    console.error('[find-email/send-otp] 계정 조회 실패:', profileErr.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const matched = !!pickFindableProfile((profiles ?? []) as FindEmailProfileRow[], name)
  if (!matched) return json({ ok: false, error: NO_MATCH_MSG }, { status: 404 })

  const code = generateOtpCode()
  const nowIso = new Date().toISOString()
  // 이전 미인증 인증번호 무효화(같은 세션·번호)
  await admin.from('phone_otps').update({ expires_at: nowIso }).eq('user_id', session.user.id).eq('phone', phone).is('verified_at', null)
  const { error: insertErr } = await admin.from('phone_otps').insert({
    user_id: session.user.id,
    phone,
    code,
    expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  })
  if (insertErr) {
    console.error('[find-email/send-otp] insert error:', insertErr.message)
    return json({ ok: false, error: '인증번호 생성에 실패했어요.' }, { status: 500 })
  }

  if (dev) {
    console.log(`\n[find-email/send-otp:DEV] 📱 ${phone} 인증번호: ${code}\n`)
    return json({ ok: true, devCode: code })
  }

  try {
    await sendSms(phone, `[CRAZYSHOT.KR] 아이디 찾기 인증번호 [${code}]을 화면에 입력해주세요. (유효시간 3분)`)
  } catch (err) {
    console.error('[find-email/send-otp] sms error:', err instanceof Error ? err.message : 'unknown')
    return json({ ok: false, error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  return json({ ok: true })
}
