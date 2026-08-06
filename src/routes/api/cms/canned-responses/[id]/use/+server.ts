// /api/cms/canned-responses/[id]/use — usage_count +1 (선택/자동완성 시점에 카운트)
// 설계 판단: "전송 시점"이 아닌 "드롭다운에서 항목을 선택한 시점"에 카운트.
// 이유: 관리자가 항목을 선택한 것 자체가 해당 응답이 유용했음을 나타냄.
// 내용을 대폭 수정 후 보내더라도 그 시작점으로 이 응답이 기여했으므로 선택 시점 카운트가 더 정확함.
// 전송 시점 카운트는 "선택 후 편집 → 되돌리기" 같은 엣지케이스에서 over-count 가능성이 있음.
//
// §E SYN-8: 동의어 학습은 실제 발신 시점(/api/chat/admin-reply)으로 이동됨.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const PATCH: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await admin.rpc('increment_canned_response_usage', { p_id: params.id })

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ ok: true })
}
