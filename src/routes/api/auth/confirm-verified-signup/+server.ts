// POST /api/auth/confirm-verified-signup
// 휴대폰 SMS OTP 인증을 실제 검증 채널로 채택 — 인증 완료된 사용자는 Supabase의
// "Confirm email" 요구사항(대시보드 Auth 설정)을 서버가 우회 처리한다.
// (CMS 관리자 계정 생성 시 email_confirm:true로 건너뛰는 것과 동일한 패턴 — cms/accounts/+page.server.ts 참고)
//
// 이 우회는 클라이언트 주장을 그대로 신뢰하지 않고, phone_otps에 실제로 최근 검증된
// 기록이 있는지 서버가 재확인한 뒤에만 실행한다.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 서버측 재확인: 클라이언트가 뭐라 하든, 최근 30분 내 이 사용자의 검증된 phone_otps
  // 기록이 실제로 있어야만 우회를 허용한다(재생 공격·타인 계정 우회 방지)
  const { data: otpRow } = await admin
    .from('phone_otps')
    .select('id')
    .eq('user_id', session.user.id)
    .not('verified_at', 'is', null)
    .gte('verified_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!otpRow) {
    return json({ ok: false, error: '휴대폰 인증 기록을 확인할 수 없습니다.' }, { status: 403 })
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(session.user.id, {
    email_confirm: true,
  })

  if (updateErr) {
    console.error('[confirm-verified-signup] updateUserById error:', updateErr.message)
    return json({ ok: false, error: '이메일 확인 처리에 실패했습니다.' }, { status: 500 })
  }

  return json({ ok: true })
}
