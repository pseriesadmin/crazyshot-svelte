// POST /api/auth/password-reset/complete — 인증 완료 후 새 비밀번호 설정 (2026-10-23)
// 3단계. verify-otp가 돌려준 토큰으로만 호출할 수 있고, 인증 후 10분 안에 한 번만 쓸 수 있다.
//   · 토큰은 먼저 "사용됨"으로 표시한 뒤 비밀번호를 바꾼다(같은 토큰으로 두 번 바꾸는 것 방지). 바꾸기에 실패하면 표시를 되돌려 다시 시도할 수 있게 한다.
//   · 이 경로는 로그인 세션을 만들지 않는다 — 고객이 새 비밀번호로 직접 로그인한다.
//   · 관리자(CMS) 계정·삭제 계정은 다시 한번 거른다(인증 이후 상태가 바뀌었을 수 있다).
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { validateNewPassword } from '$lib/server/legacyClaim'
import { VERIFIED_WINDOW_MS } from '$lib/server/passwordResetOtp'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXPIRED = '인증 시간이 지났어요. 처음부터 다시 진행해 주세요.'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!UUID_RE.test(token)) return json({ ok: false, error: EXPIRED }, { status: 400 })

  const parsed = validateNewPassword(body?.password)
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: row, error } = await admin
    .from('password_reset_otps')
    .select('id, user_id, verified_at, used_at')
    .eq('id', token)
    .maybeSingle()
  if (error) {
    console.error('[password-reset/complete] 조회 실패:', error.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const otp = row as { id: string; user_id: string; verified_at: string | null; used_at: string | null } | null
  if (!otp || !otp.verified_at || otp.used_at) return json({ ok: false, error: EXPIRED }, { status: 400 })
  if (Date.now() - new Date(otp.verified_at).getTime() > VERIFIED_WINDOW_MS) {
    return json({ ok: false, error: EXPIRED }, { status: 400 })
  }

  // 인증 이후 계정 상태 재확인 — 관리자 계정·삭제 계정은 이 경로로 비밀번호를 바꿀 수 없다
  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role, withdrawal_status, deleted_at')
    .eq('user_id', otp.user_id)
    .maybeSingle()
  const p = profile as { cms_role: string | null; withdrawal_status: string | null; deleted_at: string | null } | null
  if (!p || p.cms_role || p.deleted_at || p.withdrawal_status === 'purged') {
    return json({ ok: false, error: EXPIRED }, { status: 400 })
  }

  // 토큰을 먼저 사용 처리(조건부 갱신) — 같은 토큰을 동시에 두 번 쓰는 요청 중 하나만 통과
  const { data: claimed, error: claimErr } = await admin
    .from('password_reset_otps')
    .update({ used_at: new Date().toISOString() })
    .eq('id', otp.id)
    .is('used_at', null)
    .select('id')
  if (claimErr || !claimed || claimed.length === 0) return json({ ok: false, error: EXPIRED }, { status: 400 })

  const { error: updateErr } = await admin.auth.admin.updateUserById(otp.user_id, { password: parsed.value })
  if (updateErr) {
    console.error('[password-reset/complete] 비밀번호 변경 실패:', updateErr.message)
    await admin.from('password_reset_otps').update({ used_at: null }).eq('id', otp.id)
    return json({ ok: false, error: '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  return json({ ok: true })
}
