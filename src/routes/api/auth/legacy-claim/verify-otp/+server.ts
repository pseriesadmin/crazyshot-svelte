/**
 * POST /api/auth/legacy-claim/verify-otp
 *
 * 레거시 회원 OTP 검증 엔드포인트
 *
 * 성공 시: { ok: true, token: '<verify_token>' } 반환
 *   → 클라이언트는 이 token을 complete 엔드포인트에 전달
 *   → token은 legacy_claim_otps.id (UUID) — 서버 간 state 전달용, 노출되어도 complete에서 재검증
 *
 * 실패 응답 문구:
 *   - 코드 불일치, 만료(3분), 5회 초과 — 모두 동일한 일반 오류 문구
 *   - 남은 시도횟수 노출 금지 (EC-4 TASK.md 요건)
 */

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

const MAX_ATTEMPTS = 5
const ERROR_MSG = '인증번호가 올바르지 않거나 만료되었습니다.'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const code  = typeof body?.code  === 'string' ? body.code.trim()  : ''

  if (!phone || !code) {
    return json({ ok: false, error: ERROR_MSG }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: ERROR_MSG }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const now = new Date().toISOString()

  // 유효한 OTP 행 조회 (만료 안 됨 + 미검증 + 미클레임)
  const { data: otpRow } = await admin
    .from('legacy_claim_otps')
    .select('id, code, attempt_count')
    .eq('phone', phone)
    .is('verified_at', null)
    .is('claimed_at', null)
    .gt('expires_at', now)  // 만료 안 됨
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!otpRow) {
    return json({ ok: false, error: ERROR_MSG }, { status: 400 })
  }

  // 시도 횟수 초과 (EC-4)
  if (otpRow.attempt_count >= MAX_ATTEMPTS) {
    return json({ ok: false, error: ERROR_MSG }, { status: 400 })
  }

  // attempt_count 증가 (실패 여부와 무관하게 먼저 증가 — TOCTOU 방지)
  await admin
    .from('legacy_claim_otps')
    .update({ attempt_count: otpRow.attempt_count + 1 })
    .eq('id', otpRow.id)

  // 코드 비교
  if (otpRow.code !== code) {
    return json({ ok: false, error: ERROR_MSG }, { status: 400 })
  }

  // 검증 완료 표시
  await admin
    .from('legacy_claim_otps')
    .update({ verified_at: now })
    .eq('id', otpRow.id)

  // 성공: OTP 행 ID를 token으로 반환 (complete에서 재확인용)
  return json({ ok: true, token: otpRow.id })
}
