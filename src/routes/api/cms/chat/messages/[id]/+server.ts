// DELETE /api/cms/chat/messages/[id] — 채팅 대화카드 1건 삭제(관리자 발송 취소, 2026-10-20 Stephen 확정)
// 삭제 = 해당 행을 '대화가 삭제되었습니다.' 시스템 메시지로 교체(고객·관리자 창 모두 실시간 반영) + 원본은 관리자 전용 보관 테이블에 저장.
// 허용 범위·거절 규칙은 DB 함수 cms_delete_chat_message(Migration #733)가 최종 집행한다(고객 발신·결제/계약/쿠폰 카드·이미 삭제된 건 거절).
// 이미 나간 문자·푸시 알림은 회수되지 않는다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { chatDeleteErrorMessage } from '$lib/utils/chatMessageDelete'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  if (!UUID_RE.test(params.id)) return json({ error: '대화 id가 올바르지 않습니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_delete_chat_message', {
    p_message_id: params.id,
    p_admin_id: session.user.id,
  })

  if (error) {
    const mapped = chatDeleteErrorMessage(error.message ?? '')
    if (mapped.status === 500) console.error('[cms/chat/messages DELETE] cms_delete_chat_message 실패:', error.message)
    return json({ error: mapped.message }, { status: mapped.status })
  }
  return json({ ok: true, result: data })
}
