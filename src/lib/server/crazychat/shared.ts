// shared.ts — 크레이지챗 실행기들(조회형·접수형)이 함께 쓰는 타입과 저장 도우미 (서버 전용)

import type { ChatMessage } from '$lib/types/chat'
import type { sendPushToUser } from '$lib/server/push'
import type { CrazychatSettings } from './settings'

// chat 테이블은 database.ts 미등록 — 기존 호출부와 같이 untyped 클라이언트로 다룬다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any

export interface QueryRunContext {
  /** 세션 소유자(서버가 chat_sessions.user_id === 로그인 사용자로 이미 검증한 값) */
  userId: string
  sessionId: string
  /** 방금 저장된 고객 메시지 id */
  messageId: string
  /** 고객 원문(데이터로만 취급, 저장하지 않음) */
  content: string
  /** 관리자가 이미 이 세션에서 답한 적이 있음(chat_sessions.admin_id가 있음) */
  adminEngaged: boolean
}

export interface RunDeps {
  /** 이미 읽은 설정(여러 실행기가 같은 메시지에서 설정을 한 번만 읽도록) */
  settings?: CrazychatSettings
  sendPush?: typeof sendPushToUser
  /** 관리자에게 "크레이지챗 접수" 푸시 */
  sendAdminPush?: (admin: AdminClient, info: { kind: 'time_change' | 'extend'; userId: string; sessionId: string }) => Promise<void>
  /** 긴급 상담(상담원 호출) 관리자 푸시 */
  sendUrgent?: (admin: AdminClient, sessionId: string, userId: string) => Promise<void>
  /** 추천형 상품 검색기(테스트용 주입). 기본은 상품 자연어 검색 인덱스 */
  searchProducts?: (admin: AdminClient, query: string, tokens: readonly string[]) => Promise<{
    hits: Array<{ id: string; score: number }>
    rows: Array<{ id: string; name: string; slug: string; image_urls: string[] | null; sale_only: boolean | null; is_active?: boolean | null; option_only?: boolean | null; deleted_at?: string | null }>
    prices: Record<string, number>
    /** 동의어 변형 검색어가 실제로 사용됐는지(관찰 기록용, 없으면 false로 간주) */
    usedExpansion?: boolean
  }>
}

export type QueryRunResult = { handled: true; aiMessage: ChatMessage } | { handled: false }

export type ObservationIntent =
  | 'reservation_status' | 'return_date' | 'doc_status' | 'payment_status'
  | 'time_change' | 'extend' | 'call_agent' | 'doc_guide' | 'recommend'
export type ObservationOutcome = 'answered' | 'not_found' | 'no_data' | 'error' | 'registered' | 'duplicate' | 'need_code'

/**
 * 추천형 재보정용 메트릭(Migration 672 컬럼). 숫자·상품 id뿐 — 고객 문장·검색어 원문은 저장하지 않는다.
 * 상위 후보는 카드 발송 여부와 무관하게 기록한다(하한 미달로 탈락한 "아깝게 놓친" 후보 포함).
 */
export interface RecommendObservationMetrics {
  top_score: number | null
  card_scores: number[] | null
  product_ids: string[] | null
  min_score_used: number | null
  expanded: boolean
}

/** 메트릭 컬럼이 아직 없는 DB(Migration 672 적용 전)에서 나는 오류인지 */
function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? '')
}

/** 판정 기록(고객 원문·예약번호·값은 저장하지 않는다). 실패해도 던지지 않는다. */
export async function recordObservation(
  admin: AdminClient,
  row: { message_id: string; mode: 'observe' | 'on'; intent: ObservationIntent; outcome: ObservationOutcome; group_count: number },
  metrics?: RecommendObservationMetrics,
): Promise<void> {
  try {
    const { error } = await admin.from('crazychat_query_observations').insert(metrics ? { ...row, ...metrics } : row)
    if (error) {
      // 코드가 DB보다 먼저 배포돼 메트릭 컬럼이 없으면 메트릭 없이 1회 재시도 — 관찰 기록 자체가 사라지지 않게 한다
      if (metrics && isMissingColumnError(error)) {
        const retry = await admin.from('crazychat_query_observations').insert(row)
        if (retry.error) console.error('[crazychat] 관찰 기록 실패(fail-soft):', retry.error.message)
        return
      }
      console.error('[crazychat] 관찰 기록 실패(fail-soft):', error.message)
    }
  } catch (e) {
    console.error('[crazychat] 관찰 기록 예외(fail-soft):', e instanceof Error ? e.message : String(e))
  }
}

export type CrazychatReplySource = 'query' | 'action' | 'recommend' | 'ai'

/** 관리자 화면에서 "크레이지챗이 보낸 답변" 배지를 붙이기 위한 표시값(message_type은 text 그대로) */
export function crazychatReplyMarker(source: CrazychatReplySource): { type: 'crazychat_reply'; source: CrazychatReplySource } {
  return { type: 'crazychat_reply', source }
}

/** 고객 세션에 에이전트 답변(sender 'ai') 저장. 성공하면 메시지, 실패하면 null(던지지 않음). */
export async function insertAgentMessage(
  admin: AdminClient,
  sessionId: string,
  content: string,
  actionPayload?: Record<string, unknown>,
  source: CrazychatReplySource = 'action',
): Promise<ChatMessage | null> {
  try {
    const { data, error } = await admin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        sender_type: 'ai',
        content,
        message_type: actionPayload ? 'action_card' : 'text',
        // 텍스트 답변에는 관리자 화면 배지용 표시값을 남긴다(고객 화면은 이 값을 렌더링하지 않는다)
        action_payload: actionPayload ?? crazychatReplyMarker(source),
      })
      .select()
      .single()
    if (error || !data) {
      console.error('[crazychat] 답변 저장 실패(기존 흐름으로 이어감):', error?.message)
      return null
    }
    return data as ChatMessage
  } catch (e) {
    console.error('[crazychat] 답변 저장 예외(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** 세션 갱신 시각·고객 푸시(기본 본문에는 내용을 싣지 않는다). 실패는 무시. */
export async function afterAgentReply(
  admin: AdminClient,
  ctx: Pick<QueryRunContext, 'userId' | 'sessionId'>,
  push: typeof sendPushToUser,
  opts: { event?: string; title?: string; body?: string; link?: string } = {},
): Promise<void> {
  try {
    await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', ctx.sessionId)
  } catch (e) {
    console.error('[crazychat] 세션 갱신 실패(fail-soft):', e instanceof Error ? e.message : String(e))
  }
  try {
    await push(ctx.userId, opts.event ?? 'ai_auto_reply', {
      title: opts.title ?? '답변이 도착했어요',
      body: opts.body ?? '채팅에서 답변을 확인해 주세요.',
      link: opts.link ?? '/',
    })
  } catch (e) {
    console.error('[crazychat] 푸시 실패(fail-soft):', e instanceof Error ? e.message : String(e))
  }
}
