// GET /api/cms/chat/crazychat/drafts?filter=pending|reviewed — AI 초안 검토 목록 (S5)
// 검증을 통과한(answered) 초안만, 최근 50건. 고객 원문은 주지 않고 채팅 세션 링크만 준다(원문은 상담 화면에서 확인).
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const filter = url.searchParams.get('filter') === 'reviewed' ? 'reviewed' : 'pending'
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const base = () =>
    admin
      .from('ai_reply_observations')
      .select('id, created_at, session_id, mode, category, confidence, draft_text, sent, feedback')
      .eq('outcome', 'answered')
      .not('draft_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)
  const { data, error } = filter === 'reviewed' ? await base().not('feedback', 'is', null) : await base().is('feedback', null)
  if (error) return json({ error: '목록을 읽지 못했습니다.' }, { status: 500 })
  return json({ filter, drafts: data ?? [] })
}
