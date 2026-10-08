// /api/cms/chat/crazychat/assist — AI 조력 생성기 (수동 요청형, 즉시 운영 반영)
//   GET  : 마스터 스위치 상태 + 최근 실행 이력
//   PUT  : { enabled } 마스터 스위치 변경 (슈퍼마스터 전용)
//   POST : AI 조력 생성 1회 실행 (매니저 이상, 스위치 ON일 때만)
// 반영 결과는 ai_assist_runs/ai_assist_items에 기록되고 /assist/[runId]/rollback 으로 되돌릴 수 있다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { getRoleLevel, hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { collectAssistInput } from '$lib/server/crazychat/assist/collect'
import { createAssistDb } from '$lib/server/crazychat/assist/apply'
import { assistModelCaller, ASSIST_MODEL } from '$lib/server/crazychat/assist/model'
import { runAssistPipeline } from '$lib/server/crazychat/assist/pipeline'
import { ASSIST_ENABLED, assistDisabledResponse } from '$lib/server/crazychat/assist/switch'
import type { RequestHandler } from './$types'

const RECENT_RUNS = 10

type Guard = { response: Response } | { response?: undefined; userId: string; cmsRole: string }

async function guard(locals: App.Locals, needSuperadmin = false): Promise<Guard> {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return { response: json({ error: '권한 없음' }, { status: 401 }) }
  if (!hasSettingsAccess(cmsRole)) return { response: json({ error: '권한 없음' }, { status: 403 }) }
  if (needSuperadmin && getRoleLevel(cmsRole) < getRoleLevel('superadmin')) return { response: json({ error: '슈퍼마스터만 변경할 수 있습니다.' }, { status: 403 }) }
  const { session } = await locals.safeGetSession()
  if (!session) return { response: json({ error: '인증 필요' }, { status: 401 }) }
  return { userId: session.user.id, cmsRole }
}

const admin = (): SupabaseClient => createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function readEnabled(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from('crazychat_settings').select('assist_enabled').limit(1).maybeSingle()
  return (data as { assist_enabled?: boolean } | null)?.assist_enabled === true
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  if (!ASSIST_ENABLED) return assistDisabledResponse()
  const g = await guard(locals)
  if (g.response) return g.response
  const db = admin()
  const [enabled, runs] = await Promise.all([
    readEnabled(db),
    db.from('ai_assist_runs').select('id, created_at, status, model, input_tokens, output_tokens, summary, error').order('created_at', { ascending: false }).limit(RECENT_RUNS),
  ])
  if (runs.error) return json({ error: '이력을 읽지 못했습니다.' }, { status: 500 })
  return json({ enabled, runs: runs.data ?? [], can_toggle: getRoleLevel(g.cmsRole) >= getRoleLevel('superadmin') })
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  if (!ASSIST_ENABLED) return assistDisabledResponse()
  const g = await guard(locals, true)
  if (g.response) return g.response
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') return json({ error: 'enabled(boolean) 필요' }, { status: 400 })
  const db = admin()
  const before = await readEnabled(db)
  const { error } = await db.from('crazychat_settings').update({ assist_enabled: body.enabled, updated_by: g.userId }).not('id', 'is', null)
  if (error) return json({ error: '변경하지 못했습니다.' }, { status: 500 })
  await insertCmsAdminAuditLog(db, { actorId: g.userId, actionType: 'crazychat_setting_change', targetUserId: null, beforeValue: { assist_enabled: before }, afterValue: { assist_enabled: body.enabled } })
  return json({ enabled: body.enabled })
}

export const POST: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  if (!ASSIST_ENABLED) return assistDisabledResponse()
  const g = await guard(locals)
  if (g.response) return g.response
  const db = admin()
  if (!(await readEnabled(db))) return json({ error: 'AI 조력 생성기가 꺼져 있습니다. 슈퍼마스터가 먼저 켜야 합니다.' }, { status: 409 })

  let collected
  try {
    collected = await collectAssistInput(db)
  } catch (e) {
    console.error('[crazychat/assist] 입력 수집 실패:', e instanceof Error ? e.message : e)
    return json({ error: '입력 데이터를 읽지 못했습니다.' }, { status: 500 })
  }
  const synonyms = await loadSynonymGroups()
  const result = await runAssistPipeline({
    input: collected.input, faqsForMatch: collected.faqsForMatch, synonyms,
    db: createAssistDb(db, g.userId), callModel: assistModelCaller, model: ASSIST_MODEL,
  })
  await insertCmsAdminAuditLog(db, { actorId: g.userId, actionType: 'crazychat_setting_change', targetUserId: null, beforeValue: null, afterValue: { assist_run: result.runId ?? null, ok: result.ok, summary: result.summary ?? null } })
  if (!result.ok) return json({ ok: false, error: result.reason }, { status: 502 })
  return json({ ok: true, run_id: result.runId, summary: result.summary, dropped_questions: result.droppedQuestions, tokens: { input: result.inputTokens, output: result.outputTokens } })
}
