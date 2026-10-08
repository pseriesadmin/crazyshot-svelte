// GET /api/cms/chat/crazychat/stats?range=today|7d|all — 크레이지챗 관찰 통계 (S5). 고객 원문은 읽지 않는다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { rangeSinceIso, summarizeAi, summarizeQuery, kstDayStartIso, type AiObsRow, type QueryObsRow, type StatsRange } from '$lib/server/crazychat/stats'
import { AI_LIMITS } from '$lib/server/crazychat/ai-grounding'
import type { RequestHandler } from './$types'

const ROW_LIMIT = 5000

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const raw = url.searchParams.get('range')
  const range: StatsRange = raw === 'today' || raw === '7d' || raw === 'all' ? raw : '7d'
  const since = rangeSinceIso(range)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let q = admin.from('crazychat_query_observations').select('mode, intent, outcome').order('created_at', { ascending: false }).limit(ROW_LIMIT)
  let a = admin.from('ai_reply_observations').select('mode, outcome, reason, sent, input_tokens, output_tokens, feedback').order('created_at', { ascending: false }).limit(ROW_LIMIT)
  if (since) { q = q.gte('created_at', since); a = a.gte('created_at', since) }
  const todayStart = kstDayStartIso()
  const [qr, ar, todayAi, pending, resolved] = await Promise.all([
    q, a,
    admin.from('ai_reply_observations').select('id', { count: 'exact', head: true }).gte('created_at', todayStart).neq('outcome', 'pending'),
    admin.from('chat_agent_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('chat_agent_requests').select('id', { count: 'exact', head: true }).neq('status', 'pending').gte('created_at', since ?? '1970-01-01T00:00:00Z'),
  ])
  if (qr.error || ar.error || todayAi.error || pending.error || resolved.error) return json({ error: '통계를 읽지 못했습니다.' }, { status: 500 })

  return json({
    range,
    query: summarizeQuery((qr.data ?? []) as QueryObsRow[]),
    ai: summarizeAi((ar.data ?? []) as AiObsRow[]),
    ai_today: { calls: todayAi.count ?? 0, daily_limit: AI_LIMITS.perDay },
    requests: { pending: pending.count ?? 0, resolved: resolved.count ?? 0 },
    truncated: (qr.data?.length ?? 0) >= ROW_LIMIT || (ar.data?.length ?? 0) >= ROW_LIMIT,
  })
}
