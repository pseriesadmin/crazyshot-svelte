// chatContext.test.ts — 예약 상담 요청은 일반 대화로 정규화되고 예약 번호는 카드용으로만 따로 전달된다(고객당 대화 1개)
import { describe, it, expect } from 'vitest'
import { normalizeChatContext } from '../../lib/utils/chatContext'

describe('normalizeChatContext', () => {
  it('reservation + 예약 번호 → 일반 대화 + 카드용 예약 번호', () => {
    expect(normalizeChatContext({ contextType: 'reservation', contextReservationId: 364 })).toEqual({
      contextType: 'general',
      contextId: undefined,
      contextReservationId: undefined,
      reservationForCard: 364,
    })
  })
  it('reservation 이어도 context_id 는 버리고 예약 번호로 세션을 찾지 않는다', () => {
    const r = normalizeChatContext({ contextType: 'reservation', contextId: 'abc', contextReservationId: 5 })
    expect(r.contextId).toBeUndefined()
    expect(r.contextReservationId).toBeUndefined()
  })
  it('예약 번호가 없거나 0·음수·소수면 카드를 요청하지 않는다', () => {
    for (const bad of [undefined, 0, -3, 1.5]) {
      expect(normalizeChatContext({ contextType: 'reservation', contextReservationId: bad as number | undefined }).reservationForCard).toBeUndefined()
    }
  })
  it('reservation 이 아니면 그대로 통과(카드 없음)', () => {
    expect(normalizeChatContext({ contextType: 'general' })).toEqual({
      contextType: 'general', contextId: undefined, contextReservationId: undefined, reservationForCard: undefined,
    })
    expect(normalizeChatContext({ contextType: 'product_inquiry', contextId: 'p1' })).toMatchObject({
      contextType: 'product_inquiry', contextId: 'p1', reservationForCard: undefined,
    })
  })
})
