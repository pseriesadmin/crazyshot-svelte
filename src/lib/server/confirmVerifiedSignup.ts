// 가입 마무리 — 휴대폰 인증을 마친 임시(익명) 계정의 이메일을 계정에 확정한다 (2026-10-24)
// 배경: 가입은 임시 계정에 updateUser({email, password})를 호출하는데, Auth가 "이메일 확인" 방식이면 이메일이 계정에 바로 들어가지 않고
//   '확인 대기'(new_email)로만 걸린다. 예전 구현은 email_confirm:true(확인 완료 표시)만 보내서 대기 중 이메일이 계정에 반영되지 않았고
//   → 계정 이메일 빈 값·프로필 이메일 빈 값·이메일 로그인 불가·비밀번호 찾기 불일치로 이어졌다(결과도 확인하지 않아 조용히 실패).
// 규칙: ① 서버가 최근 30분 내 이 사용자의 검증된 phone_otps를 재확인해야만 실행 ② 대기 중 이메일을 계정에 직접 확정(메일 미발송)
//       ③ 처리 후 계정에 이메일이 실제로 들어갔는지 다시 읽어 확인 — 아니면 실패로 돌려준다(가입 화면이 오류를 안내).
import type { SupabaseClient } from '@supabase/supabase-js'

export type FinalizeResult =
  | { ok: true; email: string }
  | { ok: false; status: number; error: string }

const OTP_PROOF_WINDOW_MS = 30 * 60 * 1000

interface AuthUserLike {
  email?: string | null
  new_email?: string | null
}

export async function finalizeVerifiedSignup(admin: SupabaseClient, userId: string): Promise<FinalizeResult> {
  // 서버측 재확인: 최근 30분 내 이 사용자의 검증된 phone_otps(재생 공격·타인 계정 우회 방지)
  const { data: otpRow } = await admin
    .from('phone_otps')
    .select('id')
    .eq('user_id', userId)
    .not('verified_at', 'is', null)
    .gte('verified_at', new Date(Date.now() - OTP_PROOF_WINDOW_MS).toISOString())
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!otpRow) return { ok: false, status: 403, error: '휴대폰 인증 기록을 확인할 수 없습니다.' }

  const { data: before, error: getErr } = await admin.auth.admin.getUserById(userId)
  if (getErr || !before?.user) return { ok: false, status: 404, error: '계정을 찾을 수 없습니다.' }
  const current = before.user as unknown as AuthUserLike
  const currentEmail = (current.email ?? '').trim()
  const pendingEmail = (current.new_email ?? '').trim()

  // 이미 이메일이 계정에 있으면 확인 표시만, 없으면 대기 중 이메일을 직접 확정한다
  const target = currentEmail || pendingEmail
  if (!target) return { ok: false, status: 409, error: '가입에 사용할 이메일이 계정에 없습니다.' }

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    ...(currentEmail ? {} : { email: target }),
    email_confirm: true,
  })
  if (updateErr) {
    console.error('[confirm-verified-signup] updateUserById error:', updateErr.message)
    return { ok: false, status: 500, error: '이메일 확인 처리에 실패했습니다.' }
  }

  // 결과 검증 — 계정에 이메일이 실제로 들어갔는지 다시 읽는다
  const { data: after } = await admin.auth.admin.getUserById(userId)
  const finalEmail = ((after?.user as unknown as AuthUserLike | undefined)?.email ?? '').trim()
  if (!finalEmail) {
    console.error('[confirm-verified-signup] 처리 후에도 계정 이메일이 비어 있음')
    return { ok: false, status: 500, error: '이메일이 계정에 반영되지 않았습니다.' }
  }
  return { ok: true, email: finalEmail }
}
