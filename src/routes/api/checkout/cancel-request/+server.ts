// POST /api/checkout/cancel-request
// 고객 "예약 취소 요청" — 수령 신청 마감 후 ~ 대여 시작 전(②구간, 2026-09-30 취소 정책) 전용.
//
// 처리: 고객이 [취소 요청]을 누르면 그 고객의 채팅 세션에 '취소 요청' 대화카드(cancel_request)를
// 고객 발신 메시지로 남긴다 — 세션은 고객·관리자가 공유하므로 고객 본인 채팅창에는 "보낸 카드"로,
// 관리자 상담 화면에는 "받은 카드"로 동시에 노출된다. 관리자는 채팅 세션에서 직접 확인·수동 처리한다
// (취소 수수료율·PG 취소는 관리자가 수동으로 결정 — 이 API는 예약 상태·결제를 전혀 바꾸지 않는다).
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { sendPushToAdmins } from '$lib/server/push'
import { evaluateReservationCancelKind } from '$lib/server/cancelPolicyLoader'
import type { RequestHandler } from './$types'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { reservationId?: unknown }
  const reservationId = Number(body.reservationId)
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '예약 ID가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ─── 소유권·기본 정보 ────────────────────────────────────────────────
  const { data: rv } = await admin
    .from('rental_reservations')
    .select('id, status, user_id, tracking_number, pickup_method, start_date, end_date, reservation_code, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .maybeSingle()

  const reservation = rv as {
    id: number
    status: string
    user_id: string
    tracking_number: string | null
    pickup_method: string | null
    start_date: string | null
    end_date: string | null
    reservation_code: string | null
    products: { name: string | null } | null
  } | null

  // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-C)
  await applyParentFieldsToRowProducts([reservation], ['name'], admin)

  if (!reservation || reservation.user_id !== session.user.id) {
    return json({ ok: false, error: '취소 요청이 불가합니다.' }, { status: 403 })
  }

  // ─── 취소 요청 가능 구간(②) 서버 재판정 — 클라이언트 값 불신 ─────────────
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  const orderId = (orderItem as { order_id?: number | null } | null)?.order_id ?? null

  const kind = await evaluateReservationCancelKind(
    admin,
    {
      id: reservation.id,
      status: reservation.status,
      tracking_number: reservation.tracking_number,
      start_date: reservation.start_date,
      pickup_method: reservation.pickup_method,
    },
    orderId,
    Date.now(),
  )

  if (kind === 'free') {
    return json(
      { ok: false, code: 'use_cancel', error: '지금은 [예약 취소]로 바로 취소할 수 있습니다.' },
      { status: 409 },
    )
  }
  if (kind !== 'after_deadline') {
    return json(
      { ok: false, code: kind, error: '취소 요청이 어려운 예약입니다.\n고객센터 채팅으로 문의해주세요.' },
      { status: 403 },
    )
  }

  // ─── 중복 접수 방지 (같은 예약의 기존 취소 요청 카드) ───────────────────
  const { data: existing } = await admin
    .from('chat_messages')
    .select('id')
    .eq('message_type', 'action_card')
    .eq('action_payload->>type', 'cancel_request')
    .eq('action_payload->>reservation_id', String(reservationId))
    .limit(1)
  if (Array.isArray(existing) && existing.length > 0) {
    return json({ ok: true, duplicate: true })
  }

  // ─── 채팅 세션 확보(공유 RPC — pending/closed면 open으로 승격) + 카드 발송 ─
  const { data: chatSessionId, error: sessionErr } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id: session.user.id,
    p_reservation_id: reservationId,
  })
  if (sessionErr || !chatSessionId) {
    console.error('[cancel-request] find_or_create_general_chat_session 실패:', sessionErr?.message)
    return json({ ok: false, error: '취소 요청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  const productName = reservation.products?.name ?? '예약 상품'
  const period = reservation.start_date && reservation.end_date
    ? `${reservation.start_date.slice(0, 10)} ~ ${reservation.end_date.slice(0, 10)}`
    : undefined
  const cmsLink = `/cms/rentals?status=&selected=${reservationId}`

  const { error: insertErr } = await admin.from('chat_messages').insert({
    session_id: chatSessionId,
    sender_type: 'user',
    message_type: 'action_card',
    content: `[취소 요청] ${productName} 예약의 취소를 요청했습니다.`,
    action_payload: {
      type: 'cancel_request',
      reservation_id: String(reservationId),
      reservation_no: reservation.reservation_code ?? undefined,
      product_name: productName,
      rental_period: period,
      action_url: cmsLink,
      button_label: '취소요청 확인',
    },
  })
  if (insertErr) {
    console.error('[cancel-request] chat_messages 삽입 실패:', insertErr.message)
    return json({ ok: false, error: '취소 요청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  // 관리자 브라우저 푸시 (fail-soft — 실패해도 접수 결과에 영향 없음). 채팅 카드와 독립 경로.
  try {
    await sendPushToAdmins('urgent_chat_message', {
      title: '예약 취소 요청이 접수됐어요',
      body: `${reservation.reservation_code ? `${reservation.reservation_code} ` : ''}${productName} — 상담 세션에서 확인해주세요.`,
      link: cmsLink,
    })
  } catch {
    // 푸시 실패는 무시
  }

  return json({ ok: true })
}
