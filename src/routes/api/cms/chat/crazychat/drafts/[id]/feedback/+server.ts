// POST /api/cms/chat/crazychat/drafts/[id]/feedback — AI 초안에 정답(1)/오답(0)/보류(null) 표시 (S5)
// 이 표시는 "켜도 되는 상태인가" 판단용 통계에만 쓰이며 고객에게는 아무 영향이 없다.
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
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  if (!UUID_RE.test(params.id)) return json({ error: '유효하지 않은 ID입니다.' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as { feedback?: unknown } | null
  const fb = body?.feedback
  if (fb !== 1 && fb !== 0 && fb !== null) return json({ error: 'feedback은 1(정답)·0(오답)·null(보류)이어야 합니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('ai_reply_observations')
    .update(fb === null
      ? { feedback: null, feedback_by: null, feedback_at: null }
      : { feedback: fb, feedback_by: session.user.id, feedback_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('outcome', 'answered')
    .select('id')
  if (error) return json({ error: '저장하지 못했습니다.' }, { status: 500 })
  if (!data || data.length === 0) return json({ error: '검토할 수 있는 초안이 아닙니다.' }, { status: 404 })
  return json({ ok: true })
}
