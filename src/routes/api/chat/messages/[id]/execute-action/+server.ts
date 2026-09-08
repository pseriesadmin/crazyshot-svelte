// POST /api/chat/messages/[id]/execute-action
// 액션카드 버튼 클릭 전 서버측 만료 재검증 (CS-A2)
// 클라이언트 expires_at 비교를 신뢰하지 않고 서버에서 DB의 action_payload를 직접 재조회해 검증.
// 적용 대상: PAYMENT_REQUEST_CARD(결제요청), 기타 expires_at이 있는 모든 액션카드 공통 처리.

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ActionPayload } from '$lib/types/chat'
import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const POST: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as any

  // 메시지 조회
  const { data: msg, error: msgErr } = await db
    .from('chat_messages')
    .select('id, session_id, message_type, action_payload')
    .eq('id', params.id)
    .maybeSingle()

  if (msgErr || !msg) {
    return json({ error: '메시지를 찾을 수 없습니다.' }, { status: 404 })
  }

  const message = msg as {
    id: string
    session_id: string
    message_type: string
    action_payload: ActionPayload | null
  }

  // 액션카드 타입 검증
  if (message.message_type !== 'action_card' || !message.action_payload) {
    return json({ error: '액션 카드가 아닙니다.' }, { status: 400 })
  }

  // 세션 참여자 확인 (발신자 또는 수신자)
  const { data: chatSession } = await db
    .from('chat_sessions')
    .select('user_id, admin_id')
    .eq('id', message.session_id)
    .maybeSingle()

  if (!chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  // 2026-09-08 수정: 세션에 배정된 admin_id 하나만 허용하던 조건이 실제 CMS 운영모델(어느
  // manager+든 어느 상담세션이나 열람·조작 가능 — AdminChatPanel.svelte·admin-reply 등
  // 다른 모든 채팅 엔드포인트가 이미 이렇게 동작함)과 어긋나, 계약을 발행한 그 관리자
  // 본인이 아닌 다른 관리자 계정이 같은 세션의 카드를 클릭하면 403으로 막히던 결함을
  // 발견·수정. cms_role 보유자는 admin_id 배정 여부와 무관하게 전부 허용한다.
  const cs = chatSession as { user_id: string; admin_id: string | null }
  const cmsRole = await getCmsRoleForAction(locals)
  const isParticipant =
    cs.user_id === session.user.id || cs.admin_id === session.user.id || !!cmsRole

  if (!isParticipant) {
    return json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  }

  // 서버 측 만료 재검증 — DB의 action_payload.expires_at을 직접 확인
  const payload = message.action_payload
  const isExpiredByFlag = payload.is_expired === true
  const isExpiredByTime =
    payload.expires_at != null && new Date(payload.expires_at) < new Date()

  if (isExpiredByFlag || isExpiredByTime) {
    return json(
      { error: '기한이 만료된 액션입니다.', code: 'expired' },
      { status: 410 },
    )
  }

  // HOLD 정책 전면 개편(2026-09-07) — reservation_hold 카드는 is_expired/expires_at을
  // 채우지 않으므로(계약 발송 전까지 만료 개념 자체가 없음) 위 체크가 통과해도 실제 예약이
  // 이미 expired(계약발송 후 미서명 30분 경과)·cancelled(고객 본인 취소 또는 관리자 거부)
  // 상태일 수 있다 — 클라이언트 표시(ActionCard.svelte의 reservationHoldExpiredLive)와
  // 동일한 상태 집합을 서버에서도 재검증한다(클릭 시점 방어, ActionCard가 아직 라이브 체크를
  // 마치기 전에 클릭하는 경쟁 상황 대비).
  if (payload.type === 'reservation_hold' && payload.reservation_id) {
    const { data: reservation } = await db
      .from('rental_reservations')
      .select('status')
      .eq('id', payload.reservation_id)
      .maybeSingle()

    // 2026-09-08 수정(QA 관찰사항): code를 항상 'expired'로 고정 반환하면, 실제로는
    // "취소"(고객 본인 취소·관리자 거부)인데도 클릭한 순간 ActionCard.svelte가 영구히
    // "기한 만료"로 표시하는 라벨 오류가 생긴다 — 실제 status를 그대로 code로 전달해
    // 클라이언트가 "기한 만료"/"취소됨"을 정확히 구분해 표시하게 한다.
    if (reservation && ['expired', 'cancelled'].includes(reservation.status as string)) {
      const status = reservation.status as 'expired' | 'cancelled'
      return json(
        {
          error: status === 'cancelled' ? '취소된 예약입니다.' : '기한이 만료된 액션입니다.',
          code: status,
        },
        { status: 410 },
      )
    }
  }

  // 전자계약 발행취소 반영(2026-09-07) — contract_link(서명요청)/contract_signed(서명완료
  // 확인) 카드는 is_expired/expires_at을 채운 적이 없으므로, 관리자가 발행을 취소
  // (cancel_issued_contract RPC로 콘텐츠 전체 초기화)했는지 클릭 시점에도 재확인한다
  // (ActionCard.svelte의 contractCancelledLive와 동일한 판별 기준 재사용).
  if ((payload.type === 'contract_link' || payload.type === 'contract_signed') && payload.contract_id) {
    const { data: contract } = await db
      .from('contracts')
      .select('content_blocks, canvas_document, spreadsheet_document, html_document')
      .eq('id', payload.contract_id)
      .maybeSingle()

    // 2026-09-08 수정: 계약카드가 무효화되는 원인은 현재 오직 "관리자 발행취소"
    // (cancel_issued_contract) 하나뿐이다(서명링크 30일 만료는 이 체크 대상이 아님 —
    // /contract/[token]/sign 페이지에서 별도 처리). code를 'expired'로 고정 반환하면
    // ActionCard.svelte가 실제로는 "발행취소"인 카드를 "기한 만료"로 오표시하게 되므로
    // 'cancelled'로 전달해 정확한 라벨("발행취소")을 보여주게 한다.
    if (contract && !hasExistingContractContent(
      contract.content_blocks, contract.canvas_document, contract.spreadsheet_document, contract.html_document,
    )) {
      return json(
        { error: '발행이 취소된 계약입니다.', code: 'cancelled' },
        { status: 410 },
      )
    }
  }

  return json({ ok: true, action_url: payload.action_url ?? null })
}
