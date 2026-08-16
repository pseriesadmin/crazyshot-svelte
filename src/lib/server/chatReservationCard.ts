// 예약 컨텍스트 채팅 세션(chat_sessions.context_reservation_id)에 "예약코드·대표 상품명·대여기간"
// 요약 대화카드(RESERVATION_STATUS_CARD)가 기본으로 하나 있도록 보장하는 공용 함수.
// 호출 지점: /api/chat/sessions/[id]/reservation-card (ChatWindow가 세션 로드 직후 항상 호출)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureReservationCard(admin: any, sessionId: string, reservationId: number): Promise<void> {
  // 이미 카드가 있으면 중복 삽입 방지
  const { data: existingCard } = await admin
    .from('chat_messages')
    .select('id')
    .eq('session_id', sessionId)
    .eq('message_type', 'action_card')
    .contains('action_payload', { type: 'RESERVATION_STATUS_CARD' })
    .limit(1)
    .maybeSingle()
  if (existingCard) return

  const { data: reservation } = await admin
    .from('rental_reservations')
    .select('reservation_code, product_id, start_date, end_date')
    .eq('id', reservationId)
    .maybeSingle()
  if (!reservation) return

  const r = reservation as {
    reservation_code: string | null
    product_id: string | null
    start_date: string | null
    end_date: string | null
  }

  // 상품 정보 조회(부모 기준 — products.md §4-1 동일 원칙: 자식 재고가 아닌 부모 대표명 사용)
  let productName: string | null = null
  if (r.product_id) {
    const { data: product } = await admin
      .from('products')
      .select('name, parent_product_id')
      .eq('id', r.product_id)
      .maybeSingle()
    if (product) {
      const p = product as { name: string; parent_product_id: string | null }
      productName = p.name
      if (p.parent_product_id) {
        const { data: parent } = await admin
          .from('products')
          .select('name')
          .eq('id', p.parent_product_id)
          .maybeSingle()
        if (parent) productName = (parent as { name: string }).name
      }
    }
  }

  const rentalPeriod = r.start_date && r.end_date ? `${r.start_date} ~ ${r.end_date}` : undefined

  await admin.from('chat_messages').insert({
    session_id: sessionId,
    sender_type: 'ai',
    message_type: 'action_card',
    content: r.reservation_code
      ? `예약번호 ${r.reservation_code} 상담을 시작합니다.`
      : '예약 상담을 시작합니다.',
    action_payload: {
      type: 'RESERVATION_STATUS_CARD',
      reservation_id: String(reservationId),
      reservation_no: r.reservation_code ?? undefined,
      product_name: productName ?? undefined,
      rental_period: rentalPeriod,
      action_url: '/account/rental',
      is_expired: false,
    },
  })
}
