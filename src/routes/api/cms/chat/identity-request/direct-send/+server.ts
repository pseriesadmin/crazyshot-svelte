// POST /api/cms/chat/identity-request/direct-send
// 관리자가 고객 정보 패널(CustomerDetailPanel.svelte)의 "요청" 버튼으로 본인증명/외국인증명
// 등록요청 대화카드를 즉시 발송(Stephen 2026-08-27 요청).
// body: { session_id: string, doc_type?: 'identity' | 'foreign' }
//
// 흐름: 관리자 세션 확인 → chat_sessions에서 user_id 조회(closed/pending이면 open 승격,
//       coupon-gift/direct-send와 동일 패턴 — 이미 admin이 그 세션을 보고 있는 상태에서 보내는
//       액션이라 find_or_create_general_chat_session으로 재탐색할 필요가 없다) →
//       identity_request 메시지 INSERT(service_role) → 고객 브라우저 푸시 병행 발송.
//
// doc_type은 카드 문구·라벨에 영향을 주지 않는다 — Stephen이 지정한 카드 문구는 본인증명/
// 외국인증명 요청 모두 동일("본인증명 등록요청" / "개인정보 메뉴에서 본인증명정보를 등록
// 부탁드립니다.") — 어느 쪽이 트리거했는지는 로그·향후 확장용으로만 받아둔다.
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { sendPushToUser } from '$lib/server/push'

export const POST: RequestHandler = async ({ request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const sessionId = (body?.session_id as string | undefined)?.trim() ?? ''
  const docType = body?.doc_type === 'foreign' ? 'foreign' : 'identity'

  if (!sessionId) {
    return json({ error: 'session_id는 필수입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, user_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { user_id: string; status: string }
  const userId = cs.user_id

  if (cs.status === 'closed' || cs.status === 'pending') {
    await admin
      .from('chat_sessions')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  // doc_type='foreign'이면 /account/profile의 본인증명·외국인증명 서브탭 중 외국인증명 탭으로
  // 바로 랜딩하도록 ?doc=foreign을 실어보낸다(ProfileTabContent.svelte activeDocTab 초기값 참고)
  const actionPayload = {
    type: 'identity_request',
    doc_type: docType,
    button_label: '본인증명 등록요청',
    action_url: docType === 'foreign'
      ? '/account/profile?tab=profile&doc=foreign'
      : '/account/profile?tab=profile',
  }

  const { data: messageRaw, error: msgErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:     sessionId,
      sender_type:    'admin',
      content:        '개인정보 메뉴에서 본인증명정보를 등록 부탁드립니다.',
      message_type:   'action_card',
      action_payload: actionPayload,
      is_read:        false,
    })
    .select()
    .single()

  if (msgErr) {
    return json({ error: '메시지 전송 오류' }, { status: 500 })
  }

  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // 고객 브라우저 푸시 (service-operations.md §15 원칙 — 채팅카드와 별개 경로로 병행 발송)
  await sendPushToUser(userId, 'identity_request', {
    title: '본인증명 등록을 요청드려요',
    body: '개인정보 메뉴에서 본인증명정보를 등록해주세요.',
    link: '/account/profile?tab=profile',
  })

  return json({ ok: true, message: messageRaw })
}
