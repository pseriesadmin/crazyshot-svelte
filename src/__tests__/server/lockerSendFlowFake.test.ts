/**
 * lockerSendFlowFake.test.ts — 무인보관함 배정 저장 → 이용안내 발송 / 시범 발송 흐름을 '가짜 발송 함수'로 끝까지 시험 (2026-11-27)
 *
 * 실제 푸시·문자는 나가지 않는다(sendReservationLifecyclePush·sendSms 를 가짜로 대체). 저장 API(PATCH)와 시범 발송 API(POST)를 실제 핸들러로 호출한다.
 *  F1 저장 → 이용안내 1회 발송, 같은 예약 재저장은 재발송 없음
 *  F2 저장이 실패·거절되거나 삭제(둘 다 비움)면 발송하지 않는다
 *  F3 발송 쪽 오류·미등록 문장은 저장 결과를 막지 않는다(fail-soft)
 *  F4 시범 발송은 회사 테스트폰으로만 — 고객에게 가지 않고, 취소·만료·설정 누락·연타·발송 실패를 막는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '01000000000', SMS_TEST_PHONE: '01012345678' } as Record<string, string | undefined>,
}))

let dbRow: Record<string, unknown> | null = null
let claimRows: { id: number }[] = [{ id: 5 }]
let rpcError: { message: string } | null = null
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
const pushMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined)
const smsMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined)
const overrideMock = vi.fn(async (..._a: unknown[]): Promise<string | null> => '무인보관함이 배정됐어요')

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$env/dynamic/private', () => ({ env: h.env }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))
vi.mock('$lib/server/lockerEntrance', () => ({ getLockerEntrancePassword: async () => '#1234' }))
vi.mock('$lib/server/lockerGuideMessage', () => ({ composeLockerGuideMessage: async (_a: unknown, _id: number, o?: { leg?: string }) => `문장-${o?.leg ?? 'pickup'}` }))
vi.mock('$lib/server/sms', () => ({
  sendSms: (...a: unknown[]) => smsMock(...a),
  buildLockerGuideSms: () => '예비-수령',
  buildLockerReturnGuideSms: () => '예비-반납',
}))
vi.mock('$lib/server/notifyMessages', () => ({ getNotifyMessageOverride: (...a: unknown[]) => overrideMock(...a) }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: (...a: unknown[]) => pushMock(...a) }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        is: () => q,
        not: () => q,
        update: () => q,
        maybeSingle: async () => (table === 'push_notification_config' ? { data: { push_enabled: true }, error: null } : { data: dbRow, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: claimRows, error: null }),
      })
      return q
    },
  }),
}))

import { PATCH } from '../../routes/api/cms/reservations/[id]/locker-password/+server'
import { POST } from '../../routes/api/cms/reservations/[id]/locker-password/test-send/+server'

const locals = {
  safeGetSession: async () => ({ session: { user: { id: 'u' } } }),
  supabase: { rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { data: null, error: rpcError } } },
}

const save = async (body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> => {
  try {
    const res = await PATCH({ params: { id: '5' }, request: new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), locals } as unknown as Parameters<typeof PATCH>[0])
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 500, json: null }
  }
}
const VALID = { locker_password: '1234', locker_number: '5', locker_guide_legs: 'both' }

beforeEach(() => {
  dbRow = { locker_password: null, locker_number: null, status: 'confirmed', products: { name: '카메라' } }
  claimRows = [{ id: 5 }]
  rpcError = null
  rpcCalls.length = 0
  pushMock.mockReset().mockResolvedValue(undefined)
  smsMock.mockReset().mockResolvedValue(undefined)
  overrideMock.mockReset().mockResolvedValue('무인보관함이 배정됐어요')
  h.env.SOLAPI_API_KEY = 'a'
  h.env.SOLAPI_API_SECRET = 'b'
  h.env.SMS_SENDER_PHONE = '01000000000'
  h.env.SMS_TEST_PHONE = '01012345678'
})

describe('F1 저장 → 이용안내 발송', () => {
  it('배정 저장이 성공하면 가짜 발송이 정확히 1번 호출되고 응답이 sent 다', async () => {
    const r = await save(VALID)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ success: true, assign_notice: 'sent' })
    expect(rpcCalls).toHaveLength(1)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0].slice(1)).toEqual([5, 'locker_assign_notice'])
  })
  it('발송에는 번호·비밀번호가 실리지 않는다(허브에는 예약 id 와 알림 종류만 전달)', async () => {
    await save(VALID)
    expect(JSON.stringify(pushMock.mock.calls)).not.toContain('1234')
  })
  it('같은 예약을 번호·비밀번호만 고쳐 다시 저장해도 재발송하지 않는다(선점 대상 없음 → already_sent)', async () => {
    expect((await save(VALID)).json).toMatchObject({ assign_notice: 'sent' })
    claimRows = []
    const again = await save({ ...VALID, locker_password: '5678' })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ assign_notice: 'already_sent' })
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
})

describe('F2 저장되지 않으면 발송도 없다', () => {
  it('삭제(둘 다 비움)는 저장만 하고 발송하지 않는다', async () => {
    const r = await save({ locker_password: '', locker_number: '' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ assign_notice: null })
    expect(pushMock).not.toHaveBeenCalled()
  })
  it('검증 실패(번호만 입력·발송 대상 없음·형식 오류)는 400 이고 저장도 발송도 없다', async () => {
    for (const body of [
      { locker_password: '1234', locker_number: '' },
      { locker_password: '1234', locker_number: '5' },
      { locker_password: 'abcd', locker_number: '5', locker_guide_legs: 'both' },
    ]) {
      expect((await save(body)).status).toBe(400)
    }
    expect(rpcCalls).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })
  it('취소·만료 예약(DB 거절)은 409, 그 밖의 DB 오류는 500 — 둘 다 발송 없음', async () => {
    rpcError = { message: 'locker password not allowed for status: cancelled' }
    expect((await save(VALID)).status).toBe(409)
    rpcError = { message: 'boom' }
    expect((await save(VALID)).status).toBe(500)
    expect(pushMock).not.toHaveBeenCalled()
  })
})

describe('F3 발송 쪽 문제는 저장을 막지 않는다', () => {
  it('발송 허브가 예외를 던져도 저장은 성공(200)이고 응답만 error 다', async () => {
    pushMock.mockRejectedValue(new Error('fcm down'))
    const r = await save(VALID)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ success: true, locker_number: '5', assign_notice: 'error' })
  })
  it('등록한 안내문장이 없으면 no_message — 저장 성공, 발송 없음', async () => {
    overrideMock.mockResolvedValue(null)
    const r = await save(VALID)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ assign_notice: 'no_message' })
    expect(pushMock).not.toHaveBeenCalled()
  })
})

describe('F4 시범 발송', () => {
  let seq = 1000
  const send = async (body: Record<string, unknown> = VALID): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await POST({ params: { id: String(seq++) }, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), locals } as unknown as Parameters<typeof POST>[0])
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }

  it('회사 테스트폰으로만 보낸다 — 수신 번호가 가려져 응답되고 고객 번호는 쓰지 않는다', async () => {
    const r = await send()
    expect(r.status).toBe(200)
    expect(smsMock).toHaveBeenCalledTimes(2)
    expect(smsMock.mock.calls.every((c) => c[0] === '01012345678')).toBe(true)
    expect(r.json.to_masked).toBe('010-****-5678')
  })
  it('테스트폰 설정이 없으면 회사 발신번호로 보낸다', async () => {
    h.env.SMS_TEST_PHONE = undefined
    await send()
    expect(smsMock.mock.calls.every((c) => c[0] === '01000000000')).toBe(true)
  })
  it('취소·만료 예약은 409 — 문자 없음', async () => {
    dbRow = { ...dbRow, status: 'cancelled' }
    expect((await send()).status).toBe(409)
    dbRow = { ...dbRow, status: 'expired' }
    expect((await send()).status).toBe(409)
    expect(smsMock).not.toHaveBeenCalled()
  })
  it('문자 발송 설정(Solapi)이 없으면 503 — 보냈다고 거짓 보고하지 않는다', async () => {
    h.env.SOLAPI_API_KEY = ''
    expect((await send()).status).toBe(503)
    expect(smsMock).not.toHaveBeenCalled()
  })
  it('번호·비밀번호가 없거나 형식이 틀리면 400 — 문자 없음', async () => {
    expect((await send({ locker_guide_legs: 'both' })).status).toBe(400)
    expect((await send({ locker_password: 'abcd', locker_number: '5', locker_guide_legs: 'both' })).status).toBe(400)
    expect(smsMock).not.toHaveBeenCalled()
  })
  it('같은 예약을 10초 안에 다시 누르면 429 — 문자는 한 번만 나간다', async () => {
    const id = String(seq++)
    const call = async (): Promise<Response> =>
      POST({ params: { id }, request: new Request('http://x', { method: 'POST', body: JSON.stringify({ ...VALID, locker_guide_legs: 'pickup' }) }), locals } as unknown as Parameters<typeof POST>[0])
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(429)
    expect(smsMock).toHaveBeenCalledTimes(1)
  })
  it('문자 발송이 실패하면 502 로 알린다', async () => {
    smsMock.mockRejectedValue(new Error('solapi'))
    expect((await send()).status).toBe(502)
  })
})
