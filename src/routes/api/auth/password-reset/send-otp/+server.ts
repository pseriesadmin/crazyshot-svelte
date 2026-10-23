// POST /api/auth/password-reset/send-otp — 비밀번호 재설정 인증번호 문자 발송 (2026-10-23)
// 로그인 화면 "비밀번호 찾기" 1단계. 이메일 + 휴대폰 번호가 같은 일반 고객 계정과 일치할 때만 그 계정의 휴대폰으로 보낸다.
//   · 로그인 전 호출이라 세션이 없다 → 남용 방지는 번호별 제한(재발송 60초·1시간 5회)과 "일치할 때만 발송"으로 한다.
//   · 일치하지 않으면 문자를 보내지 않는다(비용·스팸 방지). 이메일과 번호를 둘 다 알아야 일치 여부를 알 수 있다.
//   · 인증번호는 해시로만 저장한다(원문은 문자로만 나간다).
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { sendSms } from '$lib/server/sms'
import { generateOtpCode } from '$lib/server/otpCode'
import {
  EMAIL_RE, PHONE_RE, OTP_TTL_MS, RESEND_COOLDOWN_MS, MAX_SENDS_PER_HOUR,
  normalizeEmail, normalizePhone, hashOtpCode, findResetTarget, isAdminResetMatch,
} from '$lib/server/passwordResetOtp'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  const phone = normalizePhone(body?.phone)

  if (!EMAIL_RE.test(email)) return json({ ok: false, error: '올바른 이메일 주소를 입력해 주세요.' }, { status: 400 })
  if (!PHONE_RE.test(phone)) return json({ ok: false, error: '올바른 휴대폰 번호를 입력해 주세요. (예: 01012345678)' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const target = await findResetTarget(admin, email, phone)
  if (!target) {
    // 관리자 계정은 문자 인증으로 비밀번호를 바꿀 수 없다 — 이메일·번호가 둘 다 일치할 때만 별도 안내(발송 없음)
    if (await isAdminResetMatch(admin, email, phone)) {
      return json({ ok: false, error: '관리자계정은 CMS를 통해 수정하세요.', code: 'admin_account' }, { status: 403 })
    }
    return json({ ok: false, error: '입력하신 이메일과 휴대폰 번호가 일치하는 계정을 찾을 수 없어요.' }, { status: 404 })
  }

  // 번호별 발송 제한 — 최근 1시간 발송 기록으로 판단(조회 실패 시에는 안전하게 막는다: 문자 비용·스팸 방지)
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentErr } = await admin
    .from('password_reset_otps')
    .select('created_at')
    .eq('phone', phone)
    .gt('created_at', hourAgo)
    .order('created_at', { ascending: false })
  if (recentErr) {
    console.error('[password-reset/send-otp] 발송 기록 조회 실패:', recentErr.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const recentRows = (recent ?? []) as { created_at: string }[]
  if (recentRows.length >= MAX_SENDS_PER_HOUR) {
    return json({ ok: false, error: '인증번호 요청이 너무 많아요. 1시간 뒤에 다시 시도해 주세요.' }, { status: 429 })
  }
  if (recentRows[0]) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - new Date(recentRows[0].created_at).getTime())
    if (waitMs > 0) {
      return json({ ok: false, error: `${Math.ceil(waitMs / 1000)}초 후에 다시 요청해 주세요.` }, { status: 429 })
    }
  }

  // 이 계정의 이전 미사용 인증번호는 모두 무효화(동시에 여러 개가 살아 있지 않게)
  await admin
    .from('password_reset_otps')
    .update({ expires_at: new Date().toISOString() })
    .eq('user_id', target.userId)
    .is('used_at', null)

  const id = randomUUID()
  const code = generateOtpCode()
  const { error: insertErr } = await admin.from('password_reset_otps').insert({
    id,
    user_id: target.userId,
    phone,
    code_hash: hashOtpCode(id, code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  })
  if (insertErr) {
    console.error('[password-reset/send-otp] 저장 실패:', insertErr.message)
    return json({ ok: false, error: '인증번호를 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  // 개발 환경은 문자를 보내지 않고 화면에 돌려준다(아이디 찾기 인증과 같은 방식)
  if (dev) {
    console.log(`\n[password-reset:DEV] 📱 ${phone} 인증번호: ${code}\n`)
    return json({ ok: true, devCode: code })
  }

  try {
    await sendSms(phone, `[CRAZYSHOT.KR] 비밀번호 재설정 인증번호 [${code}]을 화면에 입력해주세요. (유효시간 3분)`)
  } catch (err) {
    console.error('[password-reset/send-otp] 문자 발송 실패:', err instanceof Error ? err.message : 'unknown')
    return json({ ok: false, error: '문자 발송에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  return json({ ok: true })
}
