// GET /api/cms/chat/crazychat/knowledge — 크레이지챗 지식 저장소 조회(요약본 4종 + 최근 정리 기록). 읽기 전용.
// 권한: 크레이지챗 메뉴(consulting.crazychat) + 매니저 이상. 요약본에는 고객 식별 정보·후기 원문이 없다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { loadKnowledgeSnapshot } from '$lib/server/crazychat/knowledge/store'
import { summarizeKnowledgeForAgent } from '$lib/server/crazychat/knowledge/read'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  try {
    const [snapshot, runs] = await Promise.all([
      loadKnowledgeSnapshot(admin),
      admin.from('crazychat_knowledge_runs').select('started_at, finished_at, ok, sources').order('started_at', { ascending: false }).limit(7),
    ])
    if (runs.error) throw new Error(runs.error.message)
    const { builtAt, ...digests } = snapshot
    return json({ digests, built_at: builtAt, summary: summarizeKnowledgeForAgent(digests), runs: runs.data ?? [] })
  } catch (e) {
    console.error('[crazychat/knowledge] 조회 실패:', e instanceof Error ? e.message : e)
    return json({ error: '지식 저장소를 읽지 못했습니다.' }, { status: 500 })
  }
}
