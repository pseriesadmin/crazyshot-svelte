// POST /api/cms/chat/crazychat/assist/[runId]/rollback — AI 조력 생성기 실행 1회를 되돌린다(추가 키워드 제거 + 새로 만든 빠른답변 삭제)
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { createAssistDb, rollbackAssistRun } from '$lib/server/crazychat/assist/apply'
import { ASSIST_ENABLED, assistDisabledResponse } from '$lib/server/crazychat/assist/switch'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const POST: RequestHandler = async ({ locals, params }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  if (!ASSIST_ENABLED) return assistDisabledResponse()
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })
  if (!UUID_RE.test(params.runId)) return json({ error: '잘못된 실행 id' }, { status: 400 })

  const db = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  try {
    const r = await rollbackAssistRun(createAssistDb(db, session.user.id), params.runId)
    if (!r.ok) return json({ error: r.reason }, { status: 409 })
    await insertCmsAdminAuditLog(db, { actorId: session.user.id, actionType: 'crazychat_setting_change', targetUserId: null, beforeValue: { assist_run: params.runId }, afterValue: { rolled_back: true, removedKeywords: r.removedKeywords ?? 0, deletedFaqs: r.deletedFaqs ?? 0 } })
    return json(r)
  } catch (e) {
    console.error('[crazychat/assist] 되돌리기 실패:', e instanceof Error ? e.message : e)
    return json({ error: '되돌리지 못했습니다.' }, { status: 500 })
  }
}
