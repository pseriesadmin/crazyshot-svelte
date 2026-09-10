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
  try {
    const body = await request.json() as { phone?: string }
    phone = (body.phone ?? '').replace(/[^0-9]/g, '')
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!/^010\d{8}$/.test(phone)) {
    return json({ ok: false, error: '올바른 휴대폰 번호를 입력해 주세요. (010-XXXX-XXXX)' }, { status: 400 })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  // service_role 클라이언트로 phone_otps 삽입 (RLS bypass)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 서버측 재발송 최소 간격 — 아직 유효한(만료 전) 미인증 OTP가 있으면 재발송 차단.
  // 클라이언트 카운트다운(5분, ProfileTabContent.svelte startCountdown())과 동일 기준을
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

  if (dev) {
    // 개발 환경: SMS 미발송, 코드를 서버 콘솔에 출력 + 응답에 포함
    console.log(`\n[send-otp:DEV] 📱 ${phone} 인증번호: ${code}\n`)
    return json({ ok: true, devCode: code })
  }

  try {
    await sendSms(phone, `[크레이지샷] 휴대폰 인증번호: ${code} (5분 내 입력)`)
  } catch (err) {
    console.error('[send-otp] sms error:', err)
    return json({ ok: false, error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  return json({ ok: true })
}
