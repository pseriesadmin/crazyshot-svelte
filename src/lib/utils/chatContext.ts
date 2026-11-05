// 고객당 대화 1개 원칙(2026-11-05): 예약 상담 요청('reservation')은 별도 세션을 만들지 않고 일반 대화에 이어 붙인다.
// 이 함수는 채팅창이 연 컨텍스트를 "실제로 찾을·만들 세션 종류"와 "그 대화에 넣을 예약 안내 카드의 예약 번호"로 나눈다.
export interface ChatContextInput {
  contextType?: string
  contextId?: string
  contextReservationId?: number
}

export interface NormalizedChatContext {
  contextType: string | undefined
  contextId: string | undefined
  contextReservationId: number | undefined
  /** 일반 대화에 예약 안내 카드를 넣어야 할 예약 번호(없으면 undefined) */
  reservationForCard: number | undefined
}

export function normalizeChatContext(input: ChatContextInput): NormalizedChatContext {
  if (input.contextType === 'reservation') {
    return {
      contextType: 'general',
      contextId: undefined,
      contextReservationId: undefined,
      reservationForCard:
        Number.isInteger(input.contextReservationId) && (input.contextReservationId as number) > 0
          ? input.contextReservationId
          : undefined,
    }
  }
  return {
    contextType: input.contextType,
    contextId: input.contextId,
    contextReservationId: input.contextReservationId,
    reservationForCard: undefined,
  }
}
