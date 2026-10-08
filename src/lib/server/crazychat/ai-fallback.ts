// ai-fallback.ts — 크레이지챗 AI 답변 폴백 실행기(S4, 서버 전용)
// 쓰기 대상: ai_reply_observations(호출 기록), chat_messages·chat_sessions(켜짐 모드에서 검증 통과 답변을 보낼 때만).
// 관찰(observe) 모드는 호출·검증·기록까지만 하고 고객에게는 아무것도 보내지 않는다 → 호출부는 기존 흐름(대기 안내)을 이어간다.
// 어떤 실패도 던지지 않는다(고객 채팅이 막히면 안 된다).

import type { ChatMessage } from '$lib/types/chat'
import { sendPushToUser } from '$lib/server/push'
import {
  AI_LIMITS, buildSystemPrompt, buildUserTurn, decideRate, isEligibleForAi, labelSources, parseAiOutput, validateAiAnswer,
  type GroundingSource, type RateSnapshot,
} from './ai-grounding'
import { isHumanOnlyTopic, isTopicAllowedForAi, loadCrazychatSettings, resolveFeatureMode } from './settings'
import { afterAgentReply, insertAgentMessage, type AdminClient, type QueryRunContext, type QueryRunResult, type RunDeps } from './shared'

export interface ModelCallResult { text: string; inputTokens: number | null; outputTokens: number | null }
export type ModelCaller = (args: { system: string; userTurn: string }) => Promise<ModelCallResult>

export interface AiRunDeps extends RunDeps {
  callModel?: ModelCaller
  now?: () => Date
}

const NOT_HANDLED: QueryRunResult = { handled: false }
const MODEL = 'claude-haiku-4-5-20251001'

/** 기본 모델 호출(Anthropic). 키·SDK는 실제로 쓸 때만 불러온다. 시간 초과 8초, SDK 자체 재시도는 끈다. */
export const defaultModelCaller: ModelCaller = async ({ system, userTurn }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { ANTHROPIC_API_KEY } = await import('$env/static/private')
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 없음')
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const res = await client.messages.create(
    { model: MODEL, max_tokens: AI_LIMITS.maxTokens, system, messages: [{ role: 'user', content: userTurn }] },
    { timeout: AI_LIMITS.timeoutMs, maxRetries: 0 },
  )
  const block = res.content[0]
  return {
    text: block && block.type === 'text' ? block.text : '',
    inputTokens: res.usage?.input_tokens ?? null,
    outputTokens: res.usage?.output_tokens ?? null,
  }
}

async function countSince(admin: AdminClient, selfId: string, sinceIso: string, sessionId?: string): Promise<number> {
  let q = admin.from('ai_reply_observations').select('id', { count: 'exact', head: true }).gte('created_at', sinceIso).neq('id', selfId)
  if (sessionId) q = q.eq('session_id', sessionId)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function loadRateSnapshot(admin: AdminClient, selfId: string, sessionId: string, now: Date): Promise<RateSnapshot> {
  const iso = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const [lastMinute, lastDay, sessionRecent, recent] = await Promise.all([
    countSince(admin, selfId, iso(60_000)),
    countSince(admin, selfId, iso(24 * 3600_000)),
    countSince(admin, selfId, iso(AI_LIMITS.sessionWindowMinutes * 60_000), sessionId),
    admin.from('ai_reply_observations').select('outcome, created_at').neq('outcome', 'pending').order('created_at', { ascending: false }).limit(AI_LIMITS.breakerFailures),
  ])
  if (recent.error) throw new Error(recent.error.message)
  return { lastMinute, lastDay, sessionRecent, recentOutcomes: (recent.data ?? []) as RateSnapshot['recentOutcomes'] }
}

/** 검수 완료된 근거만 읽는다(빠른답변 pending_review=false + 정책 요약 reviewed=true) */
async function loadSources(admin: AdminClient): Promise<GroundingSource[]> {
  const [canned, policy] = await Promise.all([
    admin.from('canned_responses').select('id, title, content, category').eq('pending_review', false).order('created_at', { ascending: true }).limit(200),
    admin.from('crazychat_policy_snippets').select('id, title, content, category').eq('reviewed', true).order('created_at', { ascending: true }).limit(100),
  ])
  if (canned.error) throw new Error(canned.error.message)
  if (policy.error) throw new Error(policy.error.message)
  type Row = { id: string; title: string | null; content: string | null; category: string | null }
  const toRow = (kind: 'canned' | 'policy') => (r: Row) => ({
    id: r.id, kind, title: r.title ?? '', content: r.content ?? '', category: r.category ?? null,
  })
  const usable = (r: Row) => !!r.category && !isHumanOnlyTopic(r.category)
  return labelSources([
    ...((policy.data ?? []) as Row[]).filter(usable).map(toRow('policy')),
    ...((canned.data ?? []) as Row[]).filter(usable).map(toRow('canned')),
  ])
}

type Outcome = 'answered' | 'declined' | 'invalid' | 'error'
type FinishRow = {
  outcome: Outcome; reason: string | null; category: string | null; confidence: number | null
  input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; draft_text: string | null; sent: boolean
}

/** 호출 전에 자리를 먼저 잡는다(동시 요청에도 상한이 유지되도록). 실패하면 호출하지 않는다. */
async function reserveSlot(admin: AdminClient, row: { id: string; message_id: string; session_id: string; mode: 'observe' | 'on'; source_count: number }): Promise<boolean> {
  try {
    const { error } = await admin.from('ai_reply_observations').insert({ ...row, outcome: 'pending' })
    if (error) { console.error('[crazychat] AI 호출 자리 선점 실패(호출 안 함):', error.message); return false }
    return true
  } catch (e) {
    console.error('[crazychat] AI 호출 자리 선점 예외(호출 안 함):', e instanceof Error ? e.message : String(e))
    return false
  }
}

async function releaseSlot(admin: AdminClient, id: string): Promise<void> {
  try { await admin.from('ai_reply_observations').delete().eq('id', id) } catch { /* 자리 반납 실패는 무시 — 상한 계수에 1건 더 잡힐 뿐 */ }
}

async function finishSlot(admin: AdminClient, id: string, row: FinishRow): Promise<void> {
  try {
    const { error } = await admin.from('ai_reply_observations').update(row).eq('id', id)
    if (error) console.error('[crazychat] AI 관찰 기록 갱신 실패(fail-soft):', error.message)
  } catch (e) {
    console.error('[crazychat] AI 관찰 기록 갱신 예외(fail-soft):', e instanceof Error ? e.message : String(e))
  }
}

export async function runAiFallback(admin: AdminClient, ctx: QueryRunContext, deps: AiRunDeps = {}): Promise<QueryRunResult> {
  try {
    if (ctx.adminEngaged) return NOT_HANDLED
    const settings = deps.settings ?? (await loadCrazychatSettings(admin))
    const mode = resolveFeatureMode(settings, 'aiFallback')
    if (mode === 'off') return NOT_HANDLED
    if (!isEligibleForAi(ctx.content)) return NOT_HANDLED

    const now = (deps.now ?? (() => new Date()))()
    const slotId = crypto.randomUUID()
    // 근거를 먼저 확인(없으면 자리도 잡지 않는다)
    let sources: GroundingSource[]
    try {
      sources = await loadSources(admin)
    } catch (e) {
      console.error('[crazychat] AI 근거 읽기 실패(호출 안 함):', e instanceof Error ? e.message : String(e))
      return NOT_HANDLED
    }
    if (sources.length === 0) return NOT_HANDLED

    // ① 자리 선점(실패하면 호출 안 함) → ② 나를 뺀 최근 호출 수·연속 오류로 상한 판정 → 초과면 자리 반납
    if (!(await reserveSlot(admin, { id: slotId, message_id: ctx.messageId, session_id: ctx.sessionId, mode, source_count: sources.length }))) return NOT_HANDLED
    let allowed = false
    try {
      allowed = decideRate(await loadRateSnapshot(admin, slotId, ctx.sessionId, now), now).allow
    } catch (e) {
      console.error('[crazychat] AI 호출 상한 확인 실패(호출 안 함):', e instanceof Error ? e.message : String(e))
    }
    if (!allowed) {
      await releaseSlot(admin, slotId)
      return NOT_HANDLED
    }

    const started = Date.now()
    let result: ModelCallResult
    try {
      result = await (deps.callModel ?? defaultModelCaller)({ system: buildSystemPrompt(sources), userTurn: buildUserTurn(ctx.content) })
    } catch (e) {
      console.error('[crazychat] AI 호출 실패:', e instanceof Error ? e.message : String(e))
      await finishSlot(admin, slotId, {
        outcome: 'error', reason: 'call_failed', category: null, confidence: null,
        input_tokens: null, output_tokens: null, latency_ms: Date.now() - started, draft_text: null, sent: false,
      })
      return NOT_HANDLED
    }
    const common = { input_tokens: result.inputTokens, output_tokens: result.outputTokens, latency_ms: Date.now() - started }
    const parsed = parseAiOutput(result.text)
    const verdict = validateAiAnswer(parsed, sources)

    if (!verdict.ok) {
      // 검증 실패 초안은 고객 입력을 따라 말했을 수 있어 저장하지 않는다(사유 코드만)
      await finishSlot(admin, slotId, {
        ...common, outcome: verdict.reason === 'declined' ? 'declined' : 'invalid', reason: verdict.reason, category: null,
        confidence: parsed?.confidence ?? null, draft_text: null, sent: false,
      })
      return NOT_HANDLED
    }

    // 인용한 모든 근거의 분류가 허용 목록에 있어야 한다
    const categoryAllowed = verdict.categories.every((c) => isTopicAllowedForAi(settings, c))
    let sentMessage: ChatMessage | null = null
    if (mode === 'on' && categoryAllowed) {
      sentMessage = await insertAgentMessage(admin, ctx.sessionId, verdict.answer, undefined, 'ai')
      if (sentMessage) await afterAgentReply(admin, ctx, deps.sendPush ?? sendPushToUser)
    }
    await finishSlot(admin, slotId, {
      ...common, outcome: 'answered',
      reason: mode === 'on' && !categoryAllowed ? 'category_not_allowed' : null,
      category: verdict.category, confidence: parsed?.confidence ?? null, draft_text: verdict.answer.slice(0, 600), sent: sentMessage !== null,
    })
    return sentMessage ? { handled: true, aiMessage: sentMessage } : NOT_HANDLED
  } catch (e) {
    console.error('[crazychat] AI 폴백 실행 실패(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    return NOT_HANDLED
  }
}
