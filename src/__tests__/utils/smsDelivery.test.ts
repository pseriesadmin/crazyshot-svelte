import { describe, it, expect } from 'vitest'
import { classifyDelivery, matchSolapiMessage, buildDeliveryCards, UNDELIVERED_AFTER_MINUTES } from '$lib/utils/smsDelivery'

const T0 = new Date('2026-10-14T08:33:15Z')
const min = (m: number) => new Date(T0.getTime() + m * 60000)

describe('classifyDelivery', () => {
  it('4000은 수신 완료, 2000은 대기', () => {
    expect(classifyDelivery('4000', T0, min(1))).toBe('delivered')
    expect(classifyDelivery('2000', T0, min(90))).toBe('pending')
  })
  it('3000은 기준 시간 전엔 전송 중, 이후엔 미도착 의심', () => {
    expect(classifyDelivery('3000', T0, min(UNDELIVERED_AFTER_MINUTES - 1))).toBe('pending')
    expect(classifyDelivery('3000', T0, min(UNDELIVERED_AFTER_MINUTES))).toBe('undelivered')
  })
  it('그 외 코드는 실패, 코드 없음은 확인 불가', () => {
    expect(classifyDelivery('3013', T0, min(1))).toBe('failed')
    expect(classifyDelivery(null, T0, min(1))).toBe('unknown')
  })
})

describe('matchSolapiMessage / buildDeliveryCards', () => {
  const log = { id: 1, notify_type: 'contract_link', status: 'sent' as const, error_message: null, created_at: T0.toISOString() }
  it('태그 없는 옛 메시지는 180초 이내 가장 가까운 것과 짝지어진다', () => {
    const msgs = [
      { messageId: 'a', statusCode: '3000', dateCreated: new Date(T0.getTime() + 20000).toISOString(), type: 'LMS' },
      { messageId: 'b', statusCode: '4000', dateCreated: new Date(T0.getTime() + 600000).toISOString(), type: 'SMS' },
    ]
    expect(matchSolapiMessage(log, 297, msgs, new Set())?.messageId).toBe('a')
  })
  it('태그(예약번호·유형)가 맞는 메시지를 우선하고 다른 예약 태그는 건너뛴다', () => {
    const msgs = [
      { messageId: 'x', statusCode: '4000', dateCreated: T0.toISOString(), customFields: { reservationId: '999', notifyType: 'contract_link' } },
      { messageId: 'y', statusCode: '3000', dateCreated: new Date(T0.getTime() + 60000).toISOString(), customFields: { reservationId: '297', notifyType: 'contract_link' } },
    ]
    expect(matchSolapiMessage(log, 297, msgs, new Set())?.messageId).toBe('y')
  })
  it('이미 짝지어진 메시지는 재사용하지 않는다', () => {
    const msgs = [{ messageId: 'a', statusCode: '4000', dateCreated: T0.toISOString() }]
    const used = new Set(['a'])
    expect(matchSolapiMessage(log, 297, msgs, used)).toBeNull()
  })
  it('카드: 최신순, 미도착 의심·실패·확인 불가 구분', () => {
    const logs = [
      log,
      { id: 2, notify_type: 'reservation_approval', status: 'sent' as const, error_message: null, created_at: min(2).toISOString() },
      { id: 3, notify_type: 'return_remind', status: 'failed' as const, error_message: 'SMS 발송 실패', created_at: min(3).toISOString() },
    ]
    const msgs = [{ messageId: 'a', statusCode: '3000', dateCreated: T0.toISOString(), type: 'LMS' }]
    const cards = buildDeliveryCards(logs, 297, msgs, min(120))
    expect(cards.map(c => c.log_id)).toEqual([3, 2, 1])
    expect(cards.find(c => c.log_id === 1)?.state).toBe('undelivered')
    expect(cards.find(c => c.log_id === 2)?.state).toBe('unknown')
    expect(cards.find(c => c.log_id === 3)?.state).toBe('failed')
  })
})
