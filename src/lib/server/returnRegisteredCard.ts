/**
 * postReturnRegisteredCard — 고객이 반납정보 등록을 마치면 고객 채팅 세션에 '반납등록 확인' 대화카드를 남긴다 (2026-11-12, Stephen 지시)
 *
 * 취소 요청(cancel_request)·취소 문의(cancel_inquiry)와 같은 방식의 고객 발신 카드(고객·관리자 양쪽 노출):
 *   · 관리자 화면 CTA [반납등록 확인] → 예약 패널이 '검수' 탭으로 열려 고객이 등록한 사진·체크리스트를 바로 확인한다.
 *   · 고객 화면은 안내 문구만(관리자 CMS 주소를 열지 못하게 CTA 없음).
 * 예약 상태 전환은 update_reservation_status RPC 직접 호출이라 AUTO_NOTIFY(return_registration 카드 = 고객에게 '반납정보를 등록해 달라'는 요청 카드)를 거치지 않는다 —
 * 그 카드와는 다른 목적(고객이 등록을 끝냈다는 사실을 상담 세션에 남김)이라 별도 카드 타입(return_submitted)을 쓴다.
 * fail-soft: 카드 기록이 실패해도 반납 제출 자체는 성공으로 둔다(호출부가 결과만 로그). 같은 예약에는 카드를 한 번만 남긴다(재제출 불가 정책 + 중복 방지).
 * ⛔ 소유권·제출 저장 검증은 호출부 책임.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export type ReturnRegisteredCardResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; error: string }

export async function postReturnRegisteredCard(
  admin: SupabaseClient,
  userId: string,
  reservationId: number,
): Promise<ReturnRegisteredCardResult> {
  // 같은 예약에는 한 번만
  const { data: existing } = await admin
    .from('chat_messages')
    .select('id')
    .eq('message_type', 'action_card')
    .eq('action_payload->>type', 'return_submitted')
    .eq('action_payload->>reservation_id', String(reservationId))
    .limit(1)
  if (Array.isArray(existing) && existing.length > 0) return { ok: true, duplicate: true }

  // 카드에 보일 예약 정보(예약번호·상품 이름·대여기간) — 상품 이름은 자식 재고가 아니라 부모 값
  const { data: resv } = await admin
    .from('rental_reservations')
    .select('reservation_code, start_date, end_date, product_id, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .maybeSingle()
  const rows = resv ? [resv as Record<string, unknown>] : []
  await applyParentFieldsToRowProducts(rows, ['name'])
  const r = rows[0] as { reservation_code?: string | null; start_date?: string | null; end_date?: string | null; products?: { name?: string | null } | { name?: string | null }[] | null } | undefined
  const prod = Array.isArray(r?.products) ? r?.products[0] : r?.products
  const productName = prod?.name ?? '예약 상품'
  const period = r?.start_date && r?.end_date ? `${r.start_date.slice(0, 10)} ~ ${r.end_date.slice(0, 10)}` : undefined

  // 채팅 세션 확보(공유 RPC — pending/closed면 open으로 승격, 없으면 생성)
  const { data: chatSessionId, error: sessionErr } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id: userId,
    p_reservation_id: reservationId,
  })
  if (sessionErr || !chatSessionId) {
    console.error('[return-registered] find_or_create_general_chat_session 실패:', sessionErr?.message)
    return { ok: false, error: '반납등록 카드 기록 실패' }
  }

  const { error: insertErr } = await admin.from('chat_messages').insert({
    session_id: chatSessionId,
    sender_type: 'user',
    message_type: 'action_card',
    content: `[반납 등록] ${productName} 반납 정보를 등록했습니다.`,
    action_payload: {
      type: 'return_submitted',
      reservation_id: String(reservationId),
      reservation_no: r?.reservation_code ?? undefined,
      product_name: productName,
      rental_period: period,
      action_url: `/cms/rentals?status=returning&selected=${reservationId}`,
      button_label: '반납등록 확인',
    },
  })
  if (insertErr) {
    console.error('[return-registered] chat_messages 삽입 실패:', insertErr.message)
    return { ok: false, error: '반납등록 카드 기록 실패' }
  }
  return { ok: true }
}
