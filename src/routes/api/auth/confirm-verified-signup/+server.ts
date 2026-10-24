// POST /api/auth/confirm-verified-signup
// 휴대폰 SMS OTP 인증을 실제 검증 채널로 채택 — 인증 완료된 사용자의 이메일을 서버가 계정에 확정한다
// (Supabase "Confirm email" 설정으로 이메일이 '확인 대기'에 걸려도 계정에 반영). 규칙·검증은 confirmVerifiedSignup.ts 참고.
// 클라이언트 주장은 신뢰하지 않는다 — 최근 검증된 phone_otps 기록을 서버가 재확인한 뒤에만 실행한다.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { finalizeVerifiedSignup } from '$lib/server/confirmVerifiedSignup'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const result = await finalizeVerifiedSignup(admin, session.user.id)
  if (!result.ok) return json({ ok: false, error: result.error }, { status: result.status })
  return json({ ok: true })
}
