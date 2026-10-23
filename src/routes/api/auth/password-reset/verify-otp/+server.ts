// POST /api/auth/password-reset/verify-otp — 비밀번호 재설정 인증번호 확인 (2026-10-23)
// 2단계. 이메일 + 휴대폰 번호 + 인증번호가 모두 맞으면 비밀번호 설정용 토큰(인증번호 기록 id)을 돌려준다.
//   · 인증번호 한 건당 틀린 입력 5회까지 — 초과하면 그 인증번호는 못 쓴다(새로 요청해야 함).
//   · 시도 횟수는 비교 전에 먼저 올린다(동시에 여러 번 보내 우회하는 것을 막기 위해 조건부 갱신).
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import {
  EMAIL_RE, PHONE_RE, MAX_ATTEMPTS,
  normalizeEmail, normalizePhone, otpCodeMatches, findResetTarget,
} from '$lib/server/passwordResetOtp'
import type { RequestHandler } from './$types'

const GENERIC_FAIL = '인증번호가 올바르지 않거나 만료됐어요. 다시 확인해 주세요.'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  const phone = normalizePhone(body?.phone)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''

  if (!EMAIL_RE.test(email) || !PHONE_RE.test(phone) || !/^\d{6}$/.test(code)) {
    return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const target = await findResetTarget(admin, email, phone)
  if (!target) return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })

  const { data: row, error } = await admin
    .from('password_reset_otps')
    .select('id, code_hash, attempt_count')
    .eq('user_id', target.userId)
    .eq('phone', phone)
    .is('verified_at', null)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[password-reset/verify-otp] 조회 실패:', error.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const otp = row as { id: string; code_hash: string; attempt_count: number } | null
  if (!otp) return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })
  if (otp.attempt_count >= MAX_ATTEMPTS) {
    return json({ ok: false, error: '인증번호를 너무 많이 틀렸어요. 인증번호를 다시 요청해 주세요.' }, { status: 429 })
  }

  // 시도 횟수 먼저 +1 (조건부 갱신 — 같은 값을 본 다른 요청이 먼저 올렸다면 이 요청은 실패 처리)
  const { data: bumped, error: bumpErr } = await admin
    .from('password_reset_otps')
    .update({ attempt_count: otp.attempt_count + 1 })
    .eq('id', otp.id)
    .eq('attempt_count', otp.attempt_count)
    .select('id')
  if (bumpErr || !bumped || bumped.length === 0) {
    return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })
  }

  if (!otpCodeMatches(otp.id, code, otp.code_hash)) {
    return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })
  }

  const { data: verified, error: verifyErr } = await admin
    .from('password_reset_otps')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', otp.id)
    .is('verified_at', null)
    .select('id')
  if (verifyErr || !verified || verified.length === 0) {
    return json({ ok: false, error: GENERIC_FAIL }, { status: 400 })
  }
  return json({ ok: true, token: otp.id })
}
