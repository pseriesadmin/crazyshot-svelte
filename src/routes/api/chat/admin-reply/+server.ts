// POST /api/chat/admin-reply — 관리자 메시지 전송
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { recordSynonymLearning } from '$lib/server/synonymLearning'
import { sendPushToUser } from '$lib/server/push'
import { registerCrossLingualCandidates } from '$lib/server/crossLingualSynonymScan'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  // cms_role 확인 (service role — user_profiles RLS bypass)
  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const p = profile as { cms_role: string | null } | null
  if (!p?.cms_role) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const sessionId       = (body?.session_id        as string | undefined)?.trim() ?? ''
  const content         = (body?.content            as string | undefined)?.trim() ?? ''
  const cannedResponseId = (body?.canned_response_id as string | undefined)?.trim() || null
  // GSD-16: product_link 액션카드 페이로드 (선택적)
  const actionPayload   = (body?.action_payload     as Record<string, unknown> | undefined) ?? null
  const messageType     = actionPayload ? 'action_card' : 'text'

  if (!sessionId || !content) {
    return json({ error: 'session_id와 content는 필수입니다.' }, { status: 400 })
  }

  // 세션 확인
  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, user_id, admin_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { id: string; user_id: string; admin_id: string | null; status: string }

  // 관리자 메시지 → 항상 '진행중'(open)으로 복구
  // closed: 종료 → 재개 / pending: 대기 → 진행중
  if (cs.status === 'closed' || cs.status === 'pending') {
    await admin
      .from('chat_sessions')
      .update({
        status: 'open',
        admin_id: cs.admin_id ?? session.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
  } else if (!cs.admin_id) {
    // 이미 open 상태: admin_id 미배정이면 배정
    await admin
      .from('chat_sessions')
      .update({ admin_id: session.user.id })
      .eq('id', sessionId)
  }

  // 메시지 저장 (GSD-16: product_link action_card 포함 지원)
  const { data: message, error: insertErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:    sessionId,
      sender_type:   'admin',
      content,
      message_type:  messageType,
      action_payload: actionPayload,
      is_read:       false,
    })
    .select()
    .single()

  if (insertErr) return json({ error: insertErr.message }, { status: 500 })

  // §E SYN-8: 동의어 학습 — 관리자가 미리답변을 선택해 실제 발신한 경우에만 fire-and-forget
  if (cannedResponseId) {
    recordSynonymLearning(cannedResponseId, sessionId).catch(() => {})
  } else {
    // NLSearch A안(2026-09-02): 캔드매칭 없이 관리자가 직접 입력한 자유텍스트 답변 —
    // 직전 고객 메시지와 짝지어 빠른답변 후보로 기록(fire-and-forget). Anthropic 자유응답이
    // 임시 차단된 동안, 관리자가 수기로 처리하는 답변을 그대로 흘려보내지 않고 /cms/chat
    // QnA탭 "빠른답변 후보"에서 검토·승격할 수 있게 함(nlsearch.md §4-4).
    ;(async () => {
      const { data: lastCustomerMsg } = await admin
        .from('chat_messages')
        .select('id, content')
        .eq('session_id', sessionId)
        .eq('sender_type', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!lastCustomerMsg?.content) return

      await admin.rpc('record_chat_reply_candidate', {
        p_session_id: sessionId,
        p_customer_message_id: lastCustomerMsg.id,
        p_customer_message: lastCustomerMsg.content,
        p_admin_message_id: message.id,
        p_admin_reply: content,
        p_admin_id: session.user.id,
      })
    })().catch(() => {})
  }

  // §C-3: 관리자 메시지 이중언어 병기 패턴 학습 훅 (fire-and-forget)
  registerCrossLingualCandidates(content).catch(() => {})

  // updated_at 갱신 + CS-A3: 관리자가 답장하면 미응답 알림 상태 초기화 (다음 미응답 알림 허용)
  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString(), unanswered_notified_at: null })
    .eq('id', sessionId)

  // 고객 FCM 푸시 — 채팅 발송과 완전히 독립적으로 동작(push.ts 내부에서 절대 throw 안 함)
  await sendPushToUser(cs.user_id, 'admin_chat_reply', {
    title: '상담 답장이 도착했어요',
    body: content.length > 60 ? `${content.slice(0, 60)}…` : content,
    link: '/',
  })

  return json({ message })
}
