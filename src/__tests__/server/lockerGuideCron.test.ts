/**
 * lockerGuideCron.test.ts — /api/cron/locker-guide 발송 순서·재시도 정책 (2026-10-08)
 * 문자 먼저 → 실패하면 채팅·푸시 보내지 않고 재시도 표시 복구 / 문자 성공 후 채팅 실패는 되돌리지 않음(문자 중복 방지)
 * 번호 없음(문자 불가)이고 채팅 실패면 재시도 / 표시 복구는 루프가 끝난 뒤 한 번에.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
let claimQueue: Array<Array<Record<string, unknown>>> = []
let chatError: { message: string } | null = null
const sendSmsMock = vi.fn()
const pushMock = vi.fn(async (..._a: unknown[]): Promise<undefined> => undefined)

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 's3cret', SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: (...a: unknown[]) => pushMock(...(a as [])) }))
vi.mock('$lib/server/sms', () => ({
  sendSms: (...a: unknown[]) => sendSmsMock(...a),
  buildLockerGuideSms: (n: string | null, no: string | null, p: string) => `[크레이지샷] ${n ?? '상품'} 대여예약 무인보관함 이용정보 No ${no} / ${p}`,
  buildLockerReturnGuideSms: (n: string | null, no: string | null, p: string) => `[크레이지샷] ${n ?? '상품'} 반납 무인보관함 이용정보 No ${no} / ${p}`,
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'claim_reservations_due_for_locker_guide') return { data: claimQueue.shift() ?? [], error: null }
      if (fn === 'send_rental_chat_notification') return { data: null, error: chatError }
      return { data: null, error: null }
    },
  }),
}))

import { GET } from '../../routes/api/cron/locker-guide/+server'

const row = (id: number, phone: string | null, leg: 'pickup' | 'return' = 'pickup') => ({ reservation_id: id, leg, phone, password: '1234', locker_number: '5', product_name: '카메라' })
const call = async (): Promise<{ processed: number; succeeded: number; failed: number; retryScheduled: number }> => {
  const res = await GET({ request: new Request('http://x', { headers: { authorization: 'Bearer s3cret' } }) } as unknown as Parameters<typeof GET>[0])
  return res.json()
}
const released = (): number[] => rpcCalls.filter(c => c.fn === 'release_locker_guide_claim').map(c => c.args.p_reservation_id as number)

beforeEach(() => {
  rpcCalls.length = 0
  claimQueue = []
  chatError = null
  sendSmsMock.mockReset().mockResolvedValue(undefined)
  pushMock.mockClear()
})

describe('locker-guide cron', () => {
  it('C1: 문자 성공 → 채팅·푸시 발송, 되돌리지 않음', async () => {
    claimQueue = [[row(1, '010-1111-2222')]]
    const r = await call()
    expect(sendSmsMock).toHaveBeenCalledWith('010-1111-2222', '[크레이지샷] 카메라 대여예약 무인보관함 이용정보 No 5 / 1234')
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(r.succeeded).toBe(1)
    expect(released()).toEqual([])
  })

  it('C2: 문자 실패 → 채팅·푸시 보내지 않고(중복 방지) 표시를 되돌려 재시도 대상으로', async () => {
    sendSmsMock.mockRejectedValue(new Error('SMS 발송 실패'))
    claimQueue = [[row(2, '010-1111-2222')]]
    const r = await call()
    expect(rpcCalls.some(c => c.fn === 'send_rental_chat_notification')).toBe(false)
    expect(pushMock).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
    expect(r.retryScheduled).toBe(1)
    expect(released()).toEqual([2])
  })

  it('C3: 문자 성공 후 채팅 실패 → 되돌리지 않는다(문자가 중복 발송되지 않게)', async () => {
    chatError = { message: 'chat down' }
    claimQueue = [[row(3, '010-1111-2222')]]
    const r = await call()
    expect(r.failed).toBe(1)
    expect(released()).toEqual([])
  })

  it('C4: 번호 없음 + 채팅 성공 → 문자는 건너뛰고 성공 처리(되돌리지 않음)', async () => {
    claimQueue = [[row(4, null)]]
    const r = await call()
    expect(sendSmsMock).not.toHaveBeenCalled()
    expect(r.succeeded).toBe(1)
    expect(released()).toEqual([])
  })

  it('C5: 번호 없음 + 채팅 실패 → 아무것도 전달 못 했으므로 재시도', async () => {
    chatError = { message: 'chat down' }
    claimQueue = [[row(5, null)]]
    await call()
    expect(released()).toEqual([5])
  })

  it('C6: 표시 복구는 모든 배치 선정이 끝난 뒤에 한 번에 한다(같은 실행에서 즉시 재선정 방지)', async () => {
    sendSmsMock.mockRejectedValue(new Error('x'))
    claimQueue = [[row(6, '010-1111-2222')]]
    await call()
    const lastClaim = rpcCalls.map(c => c.fn).lastIndexOf('claim_reservations_due_for_locker_guide')
    const firstRelease = rpcCalls.map(c => c.fn).indexOf('release_locker_guide_claim')
    expect(firstRelease).toBeGreaterThan(lastClaim)
  })

  // ── 수령/반납 구분(2026-10-31, Migration #787) ──
  it('C7: 수령 건은 locker_guide, 반납 건은 locker_return_guide 유형으로 푸시한다', async () => {
    claimQueue = [[row(7, '010-1111-2222', 'pickup'), row(8, '010-1111-2222', 'return')]]
    await call()
    const types = pushMock.mock.calls.map((c) => c[2])
    expect(types).toEqual(['locker_guide', 'locker_return_guide'])
  })

  it('C8: 문장 조립이 실패한 반납 건은 반납용 고정 문자 + 반납용 채팅카드(수령용 알림 RPC 아님)로 나간다', async () => {
    claimQueue = [[row(9, '010-1111-2222', 'return')]]
    const r = await call()
    expect(sendSmsMock).toHaveBeenCalledWith('010-1111-2222', '[크레이지샷] 카메라 반납 무인보관함 이용정보 No 5 / 1234')
    expect(rpcCalls.some((c) => c.fn === 'send_rental_chat_notification')).toBe(false)
    const card = rpcCalls.find((c) => c.fn === 'send_locker_guide_card')
    expect(card?.args.p_reservation_id).toBe(9)
    expect(String(card?.args.p_content)).toContain('반납')
    expect(r.succeeded).toBe(1)
  })

  it('C9: 조립 실패한 수령 건은 기존 그대로(수령용 문자 + 알림 RPC)', async () => {
    claimQueue = [[row(10, '010-1111-2222', 'pickup')]]
    await call()
    expect(sendSmsMock).toHaveBeenCalledWith('010-1111-2222', '[크레이지샷] 카메라 대여예약 무인보관함 이용정보 No 5 / 1234')
    expect(rpcCalls.some((c) => c.fn === 'send_rental_chat_notification')).toBe(true)
  })
})
