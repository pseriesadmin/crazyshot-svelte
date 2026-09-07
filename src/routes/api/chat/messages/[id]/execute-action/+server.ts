// POST /api/chat/messages/[id]/execute-action
// 액션카드 버튼 클릭 전 서버측 만료 재검증 (CS-A2)
// 클라이언트 expires_at 비교를 신뢰하지 않고 서버에서 DB의 action_payload를 직접 재조회해 검증.
// 적용 대상: PAYMENT_REQUEST_CARD(결제요청), 기타 expires_at이 있는 모든 액션카드 공통 처리.

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ActionPayload } from '$lib/types/chat'
import { hasExistingContractContent } from '$lib/utils/contract-content-mode'

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

  const cs = chatSession as { user_id: string; admin_id: string | null }
  const isParticipant =
    cs.user_id === session.user.id || cs.admin_id === session.user.id

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

    if (reservation && ['expired', 'cancelled'].includes(reservation.status as string)) {
      return json(
        { error: '기한이 만료된 액션입니다.', code: 'expired' },
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

    if (contract && !hasExistingContractContent(
      contract.content_blocks, contract.canvas_document, contract.spreadsheet_document, contract.html_document,
    )) {
      return json(
        { error: '기한이 만료된 액션입니다.', code: 'expired' },
        { status: 410 },
      )
    }
  }

  return json({ ok: true, action_url: payload.action_url ?? null })
}
