// POST /api/cms/chat/agent-requests/[id]/resolve — 관리자가 크레이지챗 접수 요청을 "처리 완료" 또는 "반려"로 닫는다.
// body: { status: 'done' | 'rejected' }
//
// ⛔ 이 엔드포인트는 접수 기록(chat_agent_requests)의 상태만 바꾼다 — 예약·결제·계약은 관리자가 기존 화면(예약변경 등)에서
//    직접 처리한 뒤 이 버튼으로 "처리했다"고 표시하는 구조다. 대기(pending) 건에만 1회 적용된다(두 번 처리 불가).
// 권한: 상담 메뉴(consulting.chat) + 매니저 이상. 처리자·처리 시각은 이 테이블에 남긴다(감사 로그 확장은 S5).
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  if (!UUID_RE.test(params.id)) return json({ error: '유효하지 않은 요청 ID입니다.' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = body?.status
  if (status !== 'done' && status !== 'rejected') {
    return json({ error: "status는 'done' 또는 'rejected'여야 합니다." }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('chat_agent_requests')
    .update({ status, resolved_by: session.user.id, resolved_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'pending')
    .select('id')

  if (error) return json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return json({ error: '이미 처리됐거나 없는 요청입니다.' }, { status: 404 })
  return json({ ok: true })
}
