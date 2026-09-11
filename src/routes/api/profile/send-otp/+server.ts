import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { sendSms } from '$lib/server/sms'
import { dev } from '$app/environment'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  let phone: string
  let context: string | undefined
  try {
    const body = await request.json() as { phone?: string; context?: string }
    phone = (body.phone ?? '').replace(/[^0-9]/g, '')
    context = body.context
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!/^010\d{8}$/.test(phone)) {
    return json({ ok: false, error: '올바른 휴대폰 번호를 입력해 주세요. (010-XXXX-XXXX)' }, { status: 400 })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString()

  // service_role 클라이언트로 phone_otps 삽입 (RLS bypass)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 서버측 재발송 최소 간격 — 아직 유효한(만료 전) 미인증 OTP가 있으면 재발송 차단.
  // 클라이언트 카운트다운(3분, ProfileTabContent.svelte startCountdown())과 동일 기준을
  // 서버에서도 강제 — API를 직접 호출해 우회하는 SMS 스팸/과금 남용 방지.
  const { data: activeOtp, error: activeOtpErr } = await admin
    .from('phone_otps')
    .select('expires_at')
    .eq('user_id', session.user.id)
    .eq('phone', phone)
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 조회 실패 시 재발송 제한만 건너뛰고 정상 발송은 계속 진행(fail-open) — 이 조회는
  // 과금 남용 방지용 보조 체크일 뿐, 실패했다고 정상 사용자의 발송 자체를 막을 이유는 없다.
  if (activeOtpErr) console.error('[send-otp] active-otp check error:', activeOtpErr)

  if (activeOtp) {
    const remainingSec = Math.max(1, Math.ceil((new Date((activeOtp as { expires_at: string }).expires_at).getTime() - Date.now()) / 1000))
    return json(
      { ok: false, error: `이미 발송된 인증번호가 있어요. ${remainingSec}초 후 다시 시도해 주세요.` },
      { status: 429 },
    )
  }

  // 기존 미인증 OTP 만료 처리 (동일 user+phone)
  await admin
    .from('phone_otps')
    .update({ expires_at: new Date().toISOString() })
    .eq('user_id', session.user.id)
    .eq('phone', phone)
    .is('verified_at', null)

  const { error: insertErr } = await admin.from('phone_otps').insert({
    user_id: session.user.id,
    phone,
    code,
    expires_at: expiresAt,
  })

  if (insertErr) {
    console.error('[send-otp] insert error:', insertErr)
    return json({ ok: false, error: '인증번호 생성 실패' }, { status: 500 })
  }

  // 개발 환경 SMS 미발송 우회 — context를 명시적으로 보내는 호출부는 전부 제외한다
  // (Stephen 지시, 2026-09-11: 회원가입('signup')·내정보('profile') 둘 다 로컬에서도
  // 실제 문자 발송으로 검증해야 함). context 없이 호출하는 곳(예: 아이디 찾기 인증발송)만
  // 계속 무료로 우회된다 — 여러 화면이 이 엔드포인트를 공유하므로 dev 전체를 끄지 않고
  // 호출부가 명시적으로 opt-out(context 지정)한 경우에만 실발송으로 전환.
  if (dev && !context) {
    console.log(`\n[send-otp:DEV] 📱 ${phone} 인증번호: ${code}\n`)
    return json({ ok: true, devCode: code })
  }

  try {
    await sendSms(phone, `[CRAZYSHOT.KR] 본인확인 인증번호 [${code}]을 화면에 입력해주세요. (유효시간 3분)`)
  } catch (err) {
    console.error('[send-otp] sms error:', err)
    return json({ ok: false, error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  return json({ ok: true })
}
