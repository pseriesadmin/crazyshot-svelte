// action-runner.ts — 크레이지챗 접수형 실행기 (서버 전용)
//
// 고객 메시지가 "예약 시간 변경 / 연장 / 상담원 호출 / 서류 다시 제출" 요청이면 아래처럼 처리한다.
//   · time_change·extend : 본인 예약을 확인해 chat_agent_requests에 "접수"만 남기고, 고객에게 접수 안내, 관리자에게 푸시.
//                          ⛔ 예약·결제·계약 테이블에는 어떤 쓰기도 하지 않는다 — 실제 변경은 관리자가 기존 절차로 처리한다.
//   · call_agent         : 기존 긴급 상담 경로 재사용(CS_ESCALATE 기록 → 긴급 배지, 긴급 관리자 푸시).
//   · doc_guide          : 서류 미등록이면 기존 '서류 등록 요청 카드'를 바로 보내고, 확인 중·승인 완료면 안내 문구만.
//   · observe 모드는 판정만 기록하고 접수·알림·고객 안내를 하지 않는다. 어떤 실패도 던지지 않는다(handled:false → 기존 흐름).
//   · 기록(crazychat_query_observations)·접수(chat_agent_requests)에는 고객 원문을 저장하지 않는다.

import { sendCrazychatRequestAdminPush, sendPushToUser, sendUrgentChatAdminPush } from '$lib/server/push'
import { getDocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { loadCrazychatSettings, resolveFeatureMode } from './settings'
import {
  ACTION_REPLY,
  DOC_REQUEST_CARD,
  classifyActionIntent,
  pickTargetReservation,
  type ActionIntent,
  type AgentRequestKind,
} from './action'
import { PROFILE_QUERY_COLUMNS, RESERVATION_QUERY_COLUMNS, extractAllReservationCodes, groupReservations, type ReservationRowForQuery } from './query'
import {
  afterAgentReply,
  insertAgentMessage,
  recordObservation,
  type AdminClient,
  type ObservationOutcome,
  type QueryRunContext,
  type QueryRunResult,
  type RunDeps,
} from './shared'

const NOT_HANDLED: QueryRunResult = { handled: false }

export async function runCrazychatAction(
  admin: AdminClient,
  ctx: QueryRunContext,
  deps: RunDeps = {},
): Promise<QueryRunResult> {
  let mode: 'observe' | 'on' | null = null
  let intent: ActionIntent | null = null
  try {
    // EC-3: 관리자가 이미 응대 중인 세션에는 끼어들지 않는다
    if (ctx.adminEngaged) return NOT_HANDLED

    const settings = deps.settings ?? (await loadCrazychatSettings(admin))
    const resolved = resolveFeatureMode(settings, 'action')
    if (resolved === 'off') return NOT_HANDLED
    mode = resolved

    intent = classifyActionIntent(ctx.content)
    if (!intent) return NOT_HANDLED

    const push = deps.sendPush ?? sendPushToUser

    // ── 상담원 호출 ────────────────────────────────────────────────
    if (intent === 'call_agent') {
      if (mode !== 'on') {
        await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'registered', group_count: 0 })
        return NOT_HANDLED
      }
      try {
        // 긴급 배지(is_urgent)는 chat_intent_logs의 CS_ESCALATE로 판정된다(service-operations.md §13)
        const { error: logErr } = await admin.from('chat_intent_logs').insert({
          message_id: ctx.messageId, intent: 'CS_ESCALATE', confidence: 1,
          raw_response: { source: 'crazychat', kind: 'call_agent' },
        })
        if (logErr) console.error('[crazychat] 긴급 표시 기록 실패(fail-soft):', logErr.message)
      } catch (e) {
        console.error('[crazychat] 긴급 표시 기록 실패(fail-soft):', e instanceof Error ? e.message : String(e))
      }
      try {
        await (deps.sendUrgent ?? sendUrgentChatAdminPush)(admin, ctx.sessionId, ctx.userId)
      } catch (e) {
        console.error('[crazychat] 긴급 푸시 실패(fail-soft):', e instanceof Error ? e.message : String(e))
      }
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'registered', group_count: 0 })
      return await reply(admin, ctx, push, ACTION_REPLY.callAgent)
    }

    // ── 서류 재제출 안내(접수 아님) ──────────────────────────────────
    if (intent === 'doc_guide') {
      const { data, error } = await admin.from('user_profiles').select(PROFILE_QUERY_COLUMNS).eq('user_id', ctx.userId).maybeSingle()
      if (error) throw new Error(`user_profiles 조회 실패: ${error.message}`)
      if (!data) {
        await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'no_data', group_count: 0 })
        return NOT_HANDLED
      }
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'answered', group_count: 1 })
      if (mode !== 'on') return NOT_HANDLED
      const status = getDocGateStatus(data as DocGateRow)
      if (status === 'none') {
        const msg = await insertAgentMessage(admin, ctx.sessionId, ACTION_REPLY.docNone, { ...DOC_REQUEST_CARD })
        if (!msg) return NOT_HANDLED
        await afterAgentReply(admin, ctx, push, {
          event: 'identity_request', title: '본인증명 등록을 요청드려요',
          body: '개인정보 메뉴에서 본인증명정보를 등록해주세요.', link: DOC_REQUEST_CARD.action_url,
        })
        return { handled: true, aiMessage: msg }
      }
      return await reply(admin, ctx, push, status === 'pending' ? ACTION_REPLY.docPending : ACTION_REPLY.docApproved)
    }

    // ── 시간 변경·연장 접수 ─────────────────────────────────────────
    const kind: AgentRequestKind = intent
    const { data, error } = await admin
      .from('rental_reservations')
      .select(RESERVATION_QUERY_COLUMNS)
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(`rental_reservations 조회 실패: ${error.message}`)

    const codes = extractAllReservationCodes(ctx.content)
    if (codes.length > 1) {
      // 번호를 여러 개 말하면 어느 것인지 알 수 없다 — 추측하지 않고 넘긴다
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'not_found', group_count: 0 })
      return NOT_HANDLED
    }
    const requested = codes[0] ?? null
    const groups = groupReservations((data as ReservationRowForQuery[] | null) ?? [], requested)
    const pick = pickTargetReservation(groups, requested, kind)

    if (pick.kind === 'not_found' || pick.kind === 'none') {
      const outcome: ObservationOutcome = pick.kind === 'not_found' ? 'not_found' : 'no_data'
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome, group_count: 0 })
      return NOT_HANDLED
    }

    if (pick.kind === 'need_code') {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'need_code', group_count: pick.codes.length })
      if (mode !== 'on') return NOT_HANDLED
      return await reply(admin, ctx, push, ACTION_REPLY.needCode(pick.codes))
    }

    // pick.kind === 'one'
    if (mode !== 'on') {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'registered', group_count: 1 })
      return NOT_HANDLED
    }

    const { error: insertError } = await admin.from('chat_agent_requests').insert({
      user_id: ctx.userId, session_id: ctx.sessionId, message_id: ctx.messageId, kind, reservation_code: pick.code,
    })
    if (insertError) {
      if (insertError.code === '23505') {
        // 같은 고객·종류·예약의 대기 요청이 이미 있다(또는 같은 메시지가 이미 처리됨) — 새로 만들지 않는다
        await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'duplicate', group_count: 1 })
        return await reply(admin, ctx, push, ACTION_REPLY.duplicate)
      }
      throw new Error(`chat_agent_requests 저장 실패: ${insertError.message}`)
    }

    await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'registered', group_count: 1 })
    try {
      await (deps.sendAdminPush ?? sendCrazychatRequestAdminPush)(admin, { kind, userId: ctx.userId, sessionId: ctx.sessionId })
    } catch (e) {
      console.error('[crazychat] 접수 관리자 푸시 실패(fail-soft):', e instanceof Error ? e.message : String(e))
    }
    return await reply(admin, ctx, push, ACTION_REPLY.registered(kind, pick.code))
  } catch (e) {
    console.error('[crazychat] 접수형 실행 실패(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    if (mode && intent) await recordObservation(admin, { message_id: ctx.messageId, mode, intent, outcome: 'error', group_count: 0 })
    return NOT_HANDLED
  }
}

async function reply(
  admin: AdminClient,
  ctx: QueryRunContext,
  push: NonNullable<RunDeps['sendPush']>,
  content: string,
): Promise<QueryRunResult> {
  const msg = await insertAgentMessage(admin, ctx.sessionId, content)
  if (!msg) return NOT_HANDLED
  await afterAgentReply(admin, ctx, push)
  return { handled: true, aiMessage: msg }
}
