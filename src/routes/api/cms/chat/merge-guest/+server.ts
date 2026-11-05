// POST /api/cms/chat/merge-guest — 관리자가 비회원(익명) 상담 세션을 회원 계정으로 수동 병합 (2026-11-05, Stephen 지시)
// body: { session_id: string(병합할 비회원 세션), member_id: string(합칠 회원 user id) }
// 배경: 가입 뒤 로그아웃 상태로 새로 연 비회원 상담은 로그인 시 자동 병합(/api/auth/merge-guest-chat)이 닿지 않는다.
//       관리자가 정황(예약·문의 내용)으로 같은 고객임을 판단해 직접 합친다.
// 보안: 상담 채팅 메뉴 + 매니저 이상. 실제 이동은 서버 전용 DB 함수 merge_guest_chat_into_member(Migration #776)가
//       한 트랜잭션으로 처리하고 chat_guest_merge_log에 되돌릴 수 있게 기록한다 — 비회원 계정만, 회원 계정으로만 합쳐진다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DB 함수가 던지는 사유 코드 → 관리자에게 보여줄 문구
const DB_ERROR_MESSAGE: Record<string, string> = {
  GUEST_NOT_ANONYMOUS: '비회원 상담만 병합할 수 있습니다.',
  MEMBER_IS_ANONYMOUS: '회원 계정만 대상으로 선택할 수 있습니다.',
  GUEST_NOT_FOUND: '비회원 계정을 찾을 수 없습니다.',
  MEMBER_NOT_FOUND: '회원 계정을 찾을 수 없습니다.',
  SAME_USER: '같은 계정끼리는 병합할 수 없습니다.',
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : ''
  const memberId = typeof body?.member_id === 'string' ? body.member_id.trim() : ''
  if (!UUID_RE.test(sessionId) || !UUID_RE.test(memberId)) {
    return json({ error: '세션과 병합할 회원을 선택해 주세요.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data: sessionRow, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (sessionErr) {
    console.error('[merge-guest] 세션 조회 실패:', sessionErr.message)
    return json({ error: '세션 조회에 실패했습니다.' }, { status: 500 })
  }
  if (!sessionRow) return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  const guestId = (sessionRow as { user_id: string }).user_id

  // 합칠 대상은 실제 회원 프로필이 있는 계정이어야 한다(익명·삭제 계정 차단은 DB 함수가 한 번 더 확인)
  const { data: member, error: memberErr } = await admin
    .from('user_profiles')
    .select('id, deleted_at')
    .eq('id', memberId)
    .maybeSingle()
  if (memberErr) {
    console.error('[merge-guest] 회원 조회 실패:', memberErr.message)
    return json({ error: '회원 조회에 실패했습니다.' }, { status: 500 })
  }
  if (!member || (member as { deleted_at: string | null }).deleted_at) {
    return json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data, error } = await admin.rpc('merge_guest_chat_into_member', { p_guest_id: guestId, p_member_id: memberId } as never)
  if (error) {
    const code = Object.keys(DB_ERROR_MESSAGE).find((c) => error.message.includes(c))
    if (code) return json({ error: DB_ERROR_MESSAGE[code] }, { status: 400 })
    console.error('[merge-guest] 병합 실패:', error.message)
    return json({ error: '병합에 실패했습니다.' }, { status: 500 })
  }
  const r = (data ?? {}) as { sessions?: number; messages?: number }

  // 병합 뒤 관리자 화면이 열어 줄 회원의 일반 상담 세션
  const { data: target } = await admin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', memberId)
    .eq('context_type', 'general')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return json({
    ok: true,
    sessions: r.sessions ?? 0,
    messages: r.messages ?? 0,
    member_session_id: (target as { id: string } | null)?.id ?? null,
  })
}
