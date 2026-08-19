// POST /api/chat/message — 메시지 전송 + Claude AI 의도 분류
// PRD.1.7.4 | H-05: ANTHROPIC_API_KEY → $env/static/private 전용

import { json } from '@sveltejs/kit'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '$env/dynamic/private'
import { ANTHROPIC_API_KEY } from '$env/static/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'
import type { ChatMessage, ChatIntent, ActionPayload } from '$lib/types/chat'
import { matchCannedResponse } from '$lib/server/matchCannedResponse'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { enrichActionCard } from '$lib/server/chatActionEnrich'
import type { EnrichContext } from '$lib/server/chatActionEnrich'
import { registerCrossLingualCandidates } from '$lib/server/crossLingualSynonymScan'
import { sendPushToUser } from '$lib/server/push'

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// 캔드매칭이 AI 의도분류를 건너뛰므로 chat_intent_logs가 비어 긴급배지(is_urgent)가 뜨지
// 않던 결함 보완 — 파손/CS컴플레인 카테고리 캔드응답이 발송되면 그 자동응답과 별개로
// CS_ESCALATE 인텐트 로그를 남겨, 관리자 확인 없이 방치되지 않도록 한다.
const SENSITIVE_CANNED_CATEGORIES = new Set(['damage', 'cs'])

const SYSTEM_PROMPT = `당신은 크레이지샷(crazyshot.kr) 촬영장비 렌탈 플랫폼의 AI 어시스턴트입니다.
고객의 메시지를 분석하여 의도를 분류하고 적절한 응답을 생성하세요.

응답은 반드시 아래 JSON 형식만 반환하세요 (마크다운 코드블록 없이):
{
  "intent": "RESERVATION_INQUIRY" | "PAYMENT_REQUEST" | "RETURN_GUIDE" | "PRODUCT_RECOMMEND" | "CS_ESCALATE" | "GENERAL",
  "confidence": 0.0 ~ 1.0,
  "reply": "고객에게 보낼 응답 메시지",
  "action_card": null 또는 { "type": "PRODUCT_CARD" | "RESERVATION_STATUS_CARD" | "PAYMENT_REQUEST_CARD" | "RETURN_REGISTRATION_CARD" | "SHIPMENT_TRACKING_CARD" | "COUPON_GIFT_CARD" }
}

의도 분류 기준:
- RESERVATION_INQUIRY: 예약 가능 일정, 장비 대여 기간, 예약 현황 문의
- PAYMENT_REQUEST: 결제 방법, 금액, 청구 관련 문의
- RETURN_GUIDE: 반납 방법, 반납 기한, 연체 관련 문의
- PRODUCT_RECOMMEND: 장비 추천, 스펙 비교, 촬영 용도별 추천
- CS_ESCALATE: 불만, 분쟁, 파손, 분실, 복잡한 이슈 (관리자 연결 필요)
- GENERAL: 위 카테고리에 해당하지 않는 일반 문의

confidence가 0.6 미만이면 CS_ESCALATE로 처리됩니다.`

interface AIClassifierResponse {
  intent: ChatIntent
  confidence: number
  reply: string
  action_card: { type: string } | null
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const body: { session_id: string; content: string } = await request.json()

  if (!body.session_id || !body.content?.trim()) {
    return json({ error: 'session_id, content 필수입니다.' }, { status: 400 })
  }

  if (body.content.length > 1000) {
    return json({ error: '메시지는 1000자 이내로 입력해주세요.' }, { status: 400 })
  }

  // 세션 소유자 확인 (chat 테이블은 database.ts 미등록 — untyped 처리)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // service_role 클라이언트 (chat_sessions 상태 전환 + 자동답변 매칭 + intent_logs RLS bypass 공통 사용)
  // chat_sessions UPDATE RLS는 admin_update_session(is_cms_user()) 하나뿐 — 일반 고객(비 CMS
  // 직원) 세션의 status 전환은 db(고객 세션 클라이언트)로는 항상 조용히 무시됨(0행 UPDATE, 에러
  // 없음). updated_at은 trg_chat_message_update_session 트리거가 별도로 채워주지만 status는
  // 그렇지 않으므로 상태 전환은 반드시 admin으로 수행해야 함.
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const admin = serviceRoleKey ? createClient(getSupabaseUrl(), serviceRoleKey) : null

  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, status, context_type, context_id, manual_mode')
    .eq('id', body.session_id)
    .single()

  if (!chatSession || chatSession.user_id !== session.user.id) {
    return json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  // closed 세션: 반환 대신 자동 재활성화 (race condition 대비 — admin이 닫는 동안 사용자 전송)
  // §F FIX-6: 로컬 변수 갱신 — 아래 "상태 전환(공통)" 블록의 중복 업데이트 쿼리를 방지
  if (chatSession.status === 'closed' && admin) {
    await admin
      .from('chat_sessions')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', body.session_id)
    chatSession.status = 'open' // 로컬 변수 갱신: 이 블록이 실행된 후 아래 조건이 false가 됨
  }

  // 1. 사용자 메시지 INSERT
  const { data: userMessage, error: insertError } = await db
    .from('chat_messages')
    .insert({
      session_id: body.session_id,
      sender_type: 'user',
      content: body.content.trim(),
      message_type: 'text',
    })
    .select()
    .single()

  if (insertError || !userMessage) {
    return json({ error: insertError?.message ?? '메시지 저장 실패' }, { status: 500 })
  }

  // §C-3: 고객 메시지 이중언어 병기 패턴 학습 훅 (fire-and-forget)
  registerCrossLingualCandidates(body.content.trim()).catch(() => {})

  // 세션 상태 전환(어느 경로든 공통) — 새 메시지 도착 자체로 무조건 진행중 복귀
  if (chatSession.status !== 'open' && admin) {
    await admin
      .from('chat_sessions')
      .update({ status: 'open' })
      .eq('id', body.session_id)
  }

  // GSD-9: manual_mode=true 세션은 자동응답(캔드매칭+AI폴백) 전부 스킵 — 사용자 메시지 저장만 수행
  const isManualMode = (chatSession as { manual_mode?: boolean }).manual_mode === true
  if (isManualMode) {
    if (admin) {
      await admin
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', body.session_id)
    }
    return json(
      { user_message: userMessage as ChatMessage, ai_message: null, intent_log: null },
      { status: 201 },
    )
  }

  // 1-a. 하이브리드 자동답변 1단계 — 키워드 매칭을 AI보다 먼저 시도
  //   Claude 호출·API 키 상태와 완전히 무관하게 동작(장애 시에도 매칭되는 빠른답변은 계속 나감).
  //   매칭 성공 시 Claude를 아예 호출하지 않고 즉시 응답 — 이 메시지는 intent 분류를 거치지
  //   않았으므로 chat_intent_logs에는 기록하지 않음(분류한 적이 없으므로).
  if (admin) {
    try {
      const { data: arSettings } = await admin
        .from('auto_reply_settings')
        .select('enabled')
        .limit(1)
        .maybeSingle()
      const arEnabled = (arSettings as { enabled: boolean } | null)?.enabled ?? false

      if (arEnabled) {
        // GSD-20: canned_responses에 image_url/cta_label/cta_url 컬럼 추가로 조회 확장
      const { data: candidates } = await admin
          .from('canned_responses')
          .select('id, title, content, category, shortcut, match_keywords, usage_count, image_url, cta_label, cta_url')
        // §E SYN-9: 확정된 동의어 그룹을 로드해 키워드 매칭 범위를 확장
        const synonymGroups = await loadSynonymGroups()
        const match = matchCannedResponse(body.content.trim(), (candidates as CannedResponseForMatch[] ?? []), synonymGroups)

        if (match) {
          // GSD-20: 이미지/CTA 있으면 action_card 형태로, 없으면 기존 텍스트 메시지 유지
          const hasCta = !!(match.image_url || match.cta_label)
          const cannedActionPayload = hasCta
            ? {
                type: 'canned_cta',
                button_label: match.cta_label ?? '확인하기',
                action_url: match.cta_url ?? null,
                product_image: match.image_url ?? null,
                canned_response_id: match.id,
              }
            : { type: 'auto_canned_reply', canned_response_id: match.id }

          // sender_type='admin' INSERT는 RLS(participant_insert_message)가 실제 cms_role
          // 보유 계정에게만 허용 — 이 메시지는 관리자가 아니라 시스템 자동응답이므로
          // service_role(admin) 클라이언트로 삽입해야 함. db(고객 세션 클라이언트)로 삽입하면
          // 비회원(user_profiles 행 자체가 없음)은 항상 RLS에 막혀 자동답변이 나가지 않았음.
          const { data: matchedMessage, error: matchInsertErr } = await admin
            .from('chat_messages')
            .insert({
              session_id: body.session_id,
              sender_type: 'admin',
              content: match.content,
              message_type: hasCta ? 'action_card' : 'text',
              action_payload: cannedActionPayload,
            })
            .select()
            .single()

          if (!matchInsertErr && matchedMessage) {
            await admin.rpc('increment_canned_response_usage', { p_id: match.id })
            await admin
              .from('chat_sessions')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', body.session_id)

            // 민감 카테고리는 자동응답을 보내면서도 긴급판정용 인텐트 로그를 별도로 남김
            // (sessions/+server.ts의 is_urgent 판정이 이 로그를 근거로 함)
            if (match.category && SENSITIVE_CANNED_CATEGORIES.has(match.category)) {
              await admin
                .from('chat_intent_logs')
                .insert({
                  message_id: userMessage.id,
                  intent: 'CS_ESCALATE',
                  confidence: 1,
                  raw_response: {
                    source: 'canned_match',
                    canned_response_id: match.id,
                    category: match.category,
                  },
                })
            }

            // 고객 브라우저 푸시 — 캔드매칭 자동응답도 관리자 수동답장과 동일하게 발송
            // (2026-08-19 전역감사로 발견된 공백 보완, service-operations.md §15)
            await sendPushToUser(session.user.id, 'canned_auto_reply', {
              title: '답변이 도착했어요',
              body: match.content.length > 60 ? `${match.content.slice(0, 60)}…` : match.content,
              link: '/',
            })

            return json(
              {
                user_message: userMessage as ChatMessage,
                ai_message: matchedMessage as ChatMessage,
                intent_log: null,
              },
              { status: 201 },
            )
          }
        }
      }
    } catch (err) {
      // 자동답변 매칭 실패 시 2단계(AI 파이프라인)로 폴백 — 단, 원인 진단을 위해 로그는 남긴다
      console.error('[chat/message] 하이브리드 자동답변 1단계 실패:', err)
    }
  }

  // 2. 매칭 실패(또는 자동답변 꺼짐) — 2단계: 기존 AI 파이프라인. 최근 10턴 히스토리 로드
  const { data: history } = await db
    .from('chat_messages')
    .select('sender_type, content')
    .eq('session_id', body.session_id)
    .eq('message_type', 'text')
    .order('created_at', { ascending: false })
    .limit(10)

  type HistoryRow = { sender_type: string; content: string | null }
  const historyMessages: Anthropic.MessageParam[] = (history as HistoryRow[] ?? [])
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({
      role: (m.sender_type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content as string,
    }))

  // 히스토리 마지막 메시지가 현재 메시지와 중복이면 제거
  if (
    historyMessages.length > 0 &&
    historyMessages[historyMessages.length - 1].role === 'user' &&
    historyMessages[historyMessages.length - 1].content === body.content.trim()
  ) {
    historyMessages.pop()
  }

  // user/assistant 교대 보장 (Claude API 요건)
  const validHistory: Anthropic.MessageParam[] = []
  let lastRole: string | null = null
  for (const msg of historyMessages) {
    if (msg.role !== lastRole) {
      validHistory.push(msg)
      lastRole = msg.role
    }
  }

  // 현재 메시지 추가
  validHistory.push({ role: 'user', content: body.content.trim() })

  // 3. Claude Haiku AI 분류 호출
  let classified: AIClassifierResponse = {
    intent: 'CS_ESCALATE',
    confidence: 0,
    reply: '담당자에게 연결해 드리겠습니다. 잠시만 기다려 주세요.',
    action_card: null,
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: validHistory,
    })

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    const parsed = JSON.parse(rawText) as AIClassifierResponse
    classified = parsed
  } catch (err) {
    // 파싱 실패 시 CS_ESCALATE 유지 — 원인 진단을 위해 로그는 남긴다
    console.error('[chat/message] Claude 호출/파싱 실패:', err)
  }

  // 4. confidence < 0.6 → CS_ESCALATE 강제
  if (classified.confidence < 0.6) {
    classified.intent = 'CS_ESCALATE'
    classified.reply =
      classified.reply || '담당자에게 연결해 드리겠습니다. 잠시만 기다려 주세요.'
  }

  // 5. 응답 메시지 INSERT (Claude 자유응답 — 1단계에서 매칭 실패했을 때만 여기 도달)
  // AC-2: action_card가 있으면 enrichActionCard로 실데이터(상품명·예약번호 등)를 채운 후 INSERT
  let enrichedPayload: ActionPayload | null = classified.action_card
    ? { type: classified.action_card.type as ActionPayload['type'], is_expired: false }
    : null

  if (classified.action_card && admin) {
    const sessionCtx: EnrichContext = {
      context_type: (chatSession.context_type as string | null) ?? 'general',
      context_id: (chatSession.context_id as string | null) ?? null,
    }
    enrichedPayload = await enrichActionCard(
      classified.action_card.type,
      session.user.id,
      sessionCtx,
      admin,
    )
  }

  const { data: aiMessage, error: aiInsertError } = await db
    .from('chat_messages')
    .insert({
      session_id: body.session_id,
      sender_type: 'ai',
      content: classified.reply,
      message_type: enrichedPayload ? 'action_card' : 'text',
      action_payload: enrichedPayload,
    })
    .select()
    .single()

  if (aiInsertError) {
    return json({ error: aiInsertError.message }, { status: 500 })
  }

  // 6. chat_intent_logs INSERT
  //    RLS가 service_role 전용(모든 authenticated 요청 차단)이라 locals.supabase로는
  //    항상 조용히 실패했음(0건 적재) — service_role 클라이언트로 교체
  const { data: intentLog } = admin
    ? await admin
        .from('chat_intent_logs')
        .insert({
          message_id: userMessage.id,
          intent: classified.intent,
          confidence: classified.confidence,
          raw_response: classified,
        })
        .select()
        .single()
    : { data: null }

  // 7. chat_sessions updated_at 갱신
  if (admin) {
    await admin
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', body.session_id)
  }

  // 고객 브라우저 푸시 — AI 자유응답도 캔드매칭·관리자 수동답장과 동일하게 발송
  // (2026-08-19 전역감사로 발견된 공백 보완, service-operations.md §15)
  await sendPushToUser(session.user.id, 'ai_auto_reply', {
    title: '답변이 도착했어요',
    body: classified.reply.length > 60 ? `${classified.reply.slice(0, 60)}…` : classified.reply,
    link: '/',
  })

  return json(
    {
      user_message: userMessage as ChatMessage,
      ai_message: aiMessage as ChatMessage,
      intent_log: intentLog,
    },
    { status: 201 },
  )
}
