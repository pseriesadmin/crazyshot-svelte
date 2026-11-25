// GET /api/cms/customers/[userId]/managed-alert — 상담채팅 중 고객이 입력한 이름·전화번호가 관리대상과 일치하는지 (관리자 화면 경고 배너용)
// 대조는 서버에서만 수행한다. 관리대상 명단·사유는 내려가지 않고, 일치한 건의 이름·회원코드·일치 근거만 돌려준다.
// 권한: summary 엔드포인트와 같음(상담 메뉴 권한 + 매니저 이상 — 블랙리스트 정보는 파트너에게 비공개).

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { findManagedChatMatches } from '$lib/server/managedChatMatch'
import type { RequestHandler } from './$types'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'

export const GET: RequestHandler = async ({ locals, params }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const matches = await findManagedChatMatches(admin, params.id)
  return json({ matches })
}
