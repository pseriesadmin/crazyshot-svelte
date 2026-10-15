// POST /api/profile/doc-request — 본인증명 미등록 고객에게 등록 요청(채팅카드+푸시+SMS) 자동 발송 (2026-10-15)
// 상품상세 장바구니 담기·예약신청, 장바구니 예약신청 시 화면이 호출한다(예약은 막지 않는다 — Migration #716).
// 서류 상태·중복(24시간)은 서버가 직접 판정하므로 화면 값을 믿지 않는다. 로그인(가입 완료) 세션만 허용.
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { requestIdentityDocRegistration } from '$lib/server/identityDocRequest'
import { isRealMemberSession } from '$lib/utils/authGuard'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })
  // 익명 로그인(signInAnonymously) 세션은 가입 전 계정이라 요청 대상이 아니다 — 익명 계정마다 상담 세션·카드가 쌓이는 것을 막는다.
  if (!isRealMemberSession(session)) return json({ ok: false, error: '가입 완료 계정만 이용할 수 있어요' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const result = await requestIdentityDocRegistration(admin, session.user.id)
  return json({ ok: true, requested: result.requested, reason: result.reason })
}
