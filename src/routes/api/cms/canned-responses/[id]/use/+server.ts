// /api/cms/canned-responses/[id]/use — usage_count +1
// 2026-09-28 Stephen 확정: 호출 시점을 "드롭다운에서 항목을 선택한 시점"에서 "실제 전송
// 성공 시점"으로 변경(과거 결정 번복) — 선택만 하고 편집·취소하거나 팝업만 열어본 경우까지
// 과다 집계되던 문제 때문. 호출부: AdminChatPanel.svelte handleSend() 성공(res.ok) 분기.
//
// §E SYN-8: 동의어 학습은 실제 발신 시점(/api/chat/admin-reply)으로 이동됨.
import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const PATCH: RequestHandler = async ({ locals, params }) => {
  const denied = await requireAnyMenuAccessApi(locals, ['consulting.chat', 'consulting.qna'])
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await admin.rpc('increment_canned_response_usage', { p_id: params.id })

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ ok: true })
}
