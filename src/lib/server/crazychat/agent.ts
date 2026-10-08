// agent.ts — 크레이지챗 실행기 진입점: 조회형(runCrazychatQuery) + 접수형(action-runner) 순서 호출 (서버 전용)
//
// 고객 메시지 처리 API(api/chat/message)가 "빠른답변 판정 뒤, AI 단계 앞"에서 한 번 호출한다.
//   · 처리 조건: 조회 기능이 켜져 있고(마스터 ON + query on/observe), 관리자가 아직 응대하지 않은 세션이며,
//     메시지가 허용된 조회 질문이고, 사람 전용 주제·허용 밖 항목이 아닐 것.
//   · 읽기는 항상 "세션 소유자 user_id"로만, 허용된 컬럼만 service_role로 수행한다(고객이 말한 값은 본인 목록에서 고르는 용도로만 사용).
//   · observe 모드는 판정만 기록하고 고객에게 보내지 않는다. on 모드만 정해진 문장 틀로 답한다.
//   · 어떤 실패(DB 오류·저장 오류·푸시 오류)도 던지지 않는다 — handled:false면 호출부가 기존 흐름(대기 안내 등)을 그대로 이어간다.
//   · 기록(crazychat_query_observations)에는 고객 원문·예약번호·값을 저장하지 않는다(메시지 id와 분류 코드만).

import { runAiFallback } from './ai-fallback'
import { runCrazychatRecommend } from './recommend-runner'
import { sendPushToUser } from '$lib/server/push'
import type { ChatMessage } from '$lib/types/chat'
import type { DocGateRow } from '$lib/utils/docApproval'
import { loadCrazychatSettings, resolveFeatureMode } from './settings'
import { crazychatReplyMarker, recordObservation, type AdminClient, type ObservationOutcome, type QueryRunContext, type QueryRunResult, type RunDeps } from './shared'
import { runCrazychatAction } from './action-runner'
import {
  PROFILE_QUERY_COLUMNS,
  RESERVATION_QUERY_COLUMNS,
  buildDocStatusReply,
  buildQueryReply,
  classifyQueryIntent,
  extractAllReservationCodes,
  groupReservations,
  type ReservationRowForQuery,
} from './query'

export type { QueryRunContext, QueryRunResult, RunDeps as QueryRunDeps } from './shared'

export async function runCrazychatQuery(
  admin: AdminClient,
  ctx: QueryRunContext,
  deps: RunDeps = {},
): Promise<QueryRunResult> {
  try {
    // EC-3: 관리자가 이미 응대 중인 세션에는 끼어들지 않는다
    if (ctx.adminEngaged) return { handled: false }

    const settings = deps.settings ?? (await loadCrazychatSettings(admin))
    const mode = resolveFeatureMode(settings, 'query')
    if (mode === 'off') return { handled: false }

    const intent = classifyQueryIntent(ctx.content)
    if (!intent) return { handled: false }

    let reply: string | null = null
    let groupCount = 0
    let outcome: ObservationOutcome = 'no_data'

    if (intent === 'doc_status') {
      const { data, error } = await admin
        .from('user_profiles')
        .select(PROFILE_QUERY_COLUMNS)
        .eq('user_id', ctx.userId)
        .maybeSingle()
      if (error) throw new Error(`user_profiles 조회 실패: ${error.message}`)
      reply = buildDocStatusReply((data as DocGateRow | null) ?? null)
      groupCount = reply ? 1 : 0
      outcome = reply ? 'answered' : 'no_data'
    } else {
      const { data, error } = await admin
        .from('rental_reservations')
        .select(RESERVATION_QUERY_COLUMNS)
        .eq('user_id', ctx.userId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(`rental_reservations 조회 실패: ${error.message}`)

      const codes = extractAllReservationCodes(ctx.content)
      if (codes.length > 1) {
        // 번호를 여러 개 말하면 어느 것을 묻는지 알 수 없다 — 추측하지 않고 넘긴다
        outcome = 'not_found'
      } else {
        const requested = codes[0] ?? null
        const groups = groupReservations((data as ReservationRowForQuery[] | null) ?? [], requested)
        groupCount = groups.length
        reply = buildQueryReply(intent, groups)
        outcome = reply ? 'answered' : requested ? 'not_found' : 'no_data'
      }
    }

    // 관찰 모드이거나 보낼 답이 없으면 판정만 기록하고 끝낸다
    if (mode !== 'on' || !reply) {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome, group_count: groupCount })
      return { handled: false }
    }

    const { data: inserted, error: insertError } = await admin
      .from('chat_messages')
      .insert({ session_id: ctx.sessionId, sender_type: 'ai', content: reply, message_type: 'text', action_payload: crazychatReplyMarker('query') })
      .select()
      .single()
    // 기록은 실제 발송 결과를 반영한다(저장 실패인데 answered로 남지 않게)
    await recordObservation(admin, {
      message_id: ctx.messageId, mode, intent,
      outcome: insertError || !inserted ? 'error' : outcome,
      group_count: groupCount,
    })
    if (insertError || !inserted) {
      console.error('[crazychat] 조회 답변 저장 실패(기존 흐름으로 이어감):', insertError?.message)
      return { handled: false }
    }

    try {
      await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', ctx.sessionId)
    } catch (e) {
      console.error('[crazychat] 세션 갱신 실패(fail-soft):', e instanceof Error ? e.message : String(e))
    }

    try {
      const push = deps.sendPush ?? sendPushToUser
      await push(ctx.userId, 'ai_auto_reply', {
        title: '답변이 도착했어요',
        // 잠금화면 노출을 줄이기 위해 예약번호·상태는 푸시 본문에 싣지 않는다
        body: '채팅에서 답변을 확인해 주세요.',
        link: '/',
      })
    } catch (e) {
      console.error('[crazychat] 조회 답변 푸시 실패(fail-soft):', e instanceof Error ? e.message : String(e))
    }

    return { handled: true, aiMessage: inserted as ChatMessage }
  } catch (e) {
    console.error('[crazychat] 조회형 실행 실패(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    // 읽기 오류는 가능한 한 기록한다(어떤 질문이었는지는 저장하지 않음)
    try {
      const intent = classifyQueryIntent(ctx.content)
      if (intent && !ctx.adminEngaged) {
        const settings = await loadCrazychatSettings(admin)
        const mode = resolveFeatureMode(settings, 'query')
        if (mode !== 'off') await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'error', group_count: 0 })
      }
    } catch {
      /* 기록 실패는 무시 — 고객 흐름이 우선 */
    }
    return { handled: false }
  }
}

/**
 * 크레이지챗 진입점 — 고객 메시지 처리 API가 빠른답변 뒤·AI 단계 앞에서 한 번 호출한다.
 * 순서: 관리자 응대 중이면 즉시 종료 → 설정을 한 번만 읽고 → 조회형 → 접수형 → 추천형(상품 카드) → AI 폴백(S4, 기본 꺼짐·관찰 모드는 기록만).
 * 둘 다 처리하지 못하면 handled:false — 호출부가 기존 흐름(대기 안내 등)을 그대로 이어간다. 어떤 실패도 던지지 않는다.
 */
export async function runCrazychatAgent(
  admin: AdminClient,
  ctx: QueryRunContext,
  deps: RunDeps = {},
): Promise<QueryRunResult> {
  try {
    if (ctx.adminEngaged) return { handled: false }
    const settings = deps.settings ?? (await loadCrazychatSettings(admin))
    const withSettings: RunDeps = { ...deps, settings }
    const queried = await runCrazychatQuery(admin, ctx, withSettings)
    if (queried.handled) return queried
    const acted = await runCrazychatAction(admin, ctx, withSettings)
    if (acted.handled) return acted
    const recommended = await runCrazychatRecommend(admin, ctx, withSettings)
    if (recommended.handled) return recommended
    return await runAiFallback(admin, ctx, withSettings)
  } catch (e) {
    console.error('[crazychat] 에이전트 실행 실패(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    return { handled: false }
  }
}
