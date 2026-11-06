import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 연체료 알림 공용 함수 (2026-11-02, Stephen 지시)
 *  - 결제 완료(notifyLateFeePaid): 채팅 대화카드 + 고객 푸시 + 문자
 *  - 결제 요청(notifyLateFeeRequested): 푸시 + 문자(요청 대화카드는 DB 함수 auto_detect_late_fees 가 이미 만든다)
 * 모든 단계는 fail-soft — 한 채널이 실패해도 나머지 채널과 호출 흐름은 계속된다.
 */

const mockSendPushToUser = vi.fn().mockResolvedValue({ delivered: true })
const mockSendCardSms = vi.fn().mockResolvedValue(true)
vi.mock('$lib/server/push', () => ({
  sendPushToUser: (...a: unknown[]) => mockSendPushToUser(...a),
  sendCardSms: (...a: unknown[]) => mockSendCardSms(...a),
}))

const { notifyLateFeePaid, notifyLateFeeRequested } = await import('$lib/server/lateFeeNotify')

const insertedMessages: Array<Record<string, unknown>> = []

function makeAdmin(opts: { userId?: string | null; sessionId?: string | null; sessionError?: boolean } = {}) {
  const userId = opts.userId === undefined ? 'user-1' : opts.userId
  const sessionId = opts.sessionId === undefined ? 'session-1' : opts.sessionId
  return {
    from: vi.fn((table: string) => {
      if (table === 'rental_reservations') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = () => Promise.resolve({ data: userId ? { user_id: userId } : null })
        return chain
      }
      if (table === 'chat_messages') {
        return { insert: (row: Record<string, unknown>) => { insertedMessages.push(row); return Promise.resolve({ error: null }) } }
      }
      return {}
    }),
    rpc: vi.fn((name: string) => {
      if (name === 'find_or_create_general_chat_session') {
        return Promise.resolve(opts.sessionError ? { data: null, error: { message: 'x' } } : { data: sessionId, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

const INPUT = { lateFeeId: 'fee-1', reservationId: 55, feeAmount: 12000 }

describe('notifyLateFeePaid — 결제 완료 알림', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedMessages.length = 0
  })

  it('채팅 대화카드(late_fee_paid) + 푸시 + 문자를 모두 발송한다', async () => {
    await notifyLateFeePaid(makeAdmin() as never, INPUT)

    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].message_type).toBe('action_card')
    expect(insertedMessages[0].session_id).toBe('session-1')
    const payload = insertedMessages[0].action_payload as Record<string, unknown>
    expect(payload.type).toBe('late_fee_paid')
    expect(payload.late_fee_id).toBe('fee-1')
    expect(payload.reservation_id).toBe('55')
    expect(payload.action_url).toBe('/account/rental')

    expect(mockSendPushToUser).toHaveBeenCalledTimes(1)
    expect(mockSendPushToUser.mock.calls[0][0]).toBe('user-1')
    expect(mockSendPushToUser.mock.calls[0][1]).toBe('late_fee_paid')
    expect((mockSendPushToUser.mock.calls[0][2] as { body: string }).body).toContain('12,000원')

    expect(mockSendCardSms).toHaveBeenCalledTimes(1)
    const smsParams = mockSendCardSms.mock.calls[0][1] as { userId: string; reservationId: number; notifyType: string; vars?: Record<string, string> }
    expect(smsParams.notifyType).toBe('late_fee_paid')
    expect(smsParams.reservationId).toBe(55)
    expect(smsParams.vars?.연체료).toBe('12,000원')
  })

  it('채팅 세션 조회가 실패해도 푸시·문자는 발송한다(fail-soft)', async () => {
    await notifyLateFeePaid(makeAdmin({ sessionError: true }) as never, INPUT)
    expect(insertedMessages).toHaveLength(0)
    expect(mockSendPushToUser).toHaveBeenCalledTimes(1)
    expect(mockSendCardSms).toHaveBeenCalledTimes(1)
  })

  it('푸시가 예외를 던져도 문자는 발송하고 호출은 정상 종료한다', async () => {
    mockSendPushToUser.mockRejectedValueOnce(new Error('push down'))
    await expect(notifyLateFeePaid(makeAdmin() as never, INPUT)).resolves.toBeUndefined()
    expect(mockSendCardSms).toHaveBeenCalledTimes(1)
  })

  it('예약의 고객을 찾지 못하면 아무것도 발송하지 않는다', async () => {
    await notifyLateFeePaid(makeAdmin({ userId: null }) as never, INPUT)
    expect(insertedMessages).toHaveLength(0)
    expect(mockSendPushToUser).not.toHaveBeenCalled()
    expect(mockSendCardSms).not.toHaveBeenCalled()
  })
})

describe('notifyLateFeeRequested — 결제 요청 알림(카드는 DB 함수가 이미 생성)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedMessages.length = 0
    mockSendPushToUser.mockResolvedValue({ delivered: true })
    mockSendCardSms.mockResolvedValue(true)
  })

  it('푸시 + 문자만 발송하고 채팅카드는 만들지 않는다 — 결제 페이지 링크를 싣고 true 를 돌려준다', async () => {
    const ok = await notifyLateFeeRequested(makeAdmin() as never, INPUT)

    expect(ok).toBe(true)
    expect(insertedMessages).toHaveLength(0)
    expect(mockSendPushToUser.mock.calls[0][1]).toBe('late_fee_request')
    expect((mockSendPushToUser.mock.calls[0][2] as { link: string }).link).toBe('/pay/late-fee/fee-1')
    const smsParams = mockSendCardSms.mock.calls[0][1] as { notifyType: string; link?: string }
    expect(smsParams.notifyType).toBe('late_fee_request')
    expect(smsParams.link).toBe('/pay/late-fee/fee-1')
  })

  it('푸시는 실패해도 문자가 나갔으면 true', async () => {
    mockSendPushToUser.mockResolvedValue({ delivered: false, reason: 'disabled' })
    expect(await notifyLateFeeRequested(makeAdmin() as never, INPUT)).toBe(true)
  })

  it('문자는 실패해도 푸시가 전달됐으면 true', async () => {
    mockSendCardSms.mockResolvedValue(false)
    expect(await notifyLateFeeRequested(makeAdmin() as never, INPUT)).toBe(true)
  })

  it('푸시·문자가 모두 실패하면 false — 예외를 던져도 호출은 정상 종료(false)', async () => {
    mockSendPushToUser.mockRejectedValueOnce(new Error('x'))
    mockSendCardSms.mockRejectedValueOnce(new Error('y'))
    await expect(notifyLateFeeRequested(makeAdmin() as never, INPUT)).resolves.toBe(false)
  })

  it('예약의 고객을 찾지 못하면 false', async () => {
    expect(await notifyLateFeeRequested(makeAdmin({ userId: null }) as never, INPUT)).toBe(false)
    expect(mockSendPushToUser).not.toHaveBeenCalled()
  })
})
