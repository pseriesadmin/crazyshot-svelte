/**
 * lockerPasswordApiLegs.test.ts — 무인보관함 배정 API의 발송 대상(수령/반납) 처리 (2026-10-31, Migration #787)
 *  A1 저장: 비밀번호를 저장할 때 발송 대상 필수(없거나 허용값 밖이면 400, RPC 호출 없음)
 *  A2 저장: 유효하면 p_legs 로 RPC에 전달 / 삭제(둘 다 비움)면 p_legs=null
 *  A3 조회: 비밀번호가 있을 때만 발송 대상을 내려준다(폐기 뒤 남은 값이 미리 선택돼 보이지 않게)
 *  A4 시범 발송: 발송 대상이 없으면 400, 수령+반납이면 문자 2통(수령 → 반납 순서)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let dbRow: Record<string, unknown> | null = null
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
const sendSmsMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined)

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '01000000000', SMS_TEST_PHONE: '01012345678' } }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))
vi.mock('$lib/server/lockerEntrance', () => ({ getLockerEntrancePassword: async () => '#1234' }))
vi.mock('$lib/server/lockerGuideMessage', () => ({
  composeLockerGuideMessage: async (_a: unknown, _id: number, o?: { leg?: string }) => `문장-${o?.leg ?? 'pickup'}`,
}))
vi.mock('$lib/server/sms', () => ({
  sendSms: (...a: unknown[]) => sendSmsMock(...a),
  buildLockerGuideSms: () => '예비-수령',
  buildLockerReturnGuideSms: () => '예비-반납',
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: dbRow, error: null }) }) }) }),
  }),
}))

import { GET, PATCH } from '../../routes/api/cms/reservations/[id]/locker-password/+server'
import { POST } from '../../routes/api/cms/reservations/[id]/locker-password/test-send/+server'

const locals = {
  safeGetSession: async () => ({ session: { user: { id: 'u' } } }),
  supabase: { rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { data: null, error: null } } },
}
const patch = async (body: Record<string, unknown>): Promise<{ status: number }> => {
  try {
    await PATCH({ params: { id: '5' }, request: new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), locals } as unknown as Parameters<typeof PATCH>[0])
    return { status: 200 }
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 500 }
  }
}

beforeEach(() => {
  rpcCalls.length = 0
  dbRow = null
  sendSmsMock.mockClear()
})

describe('A1·A2 저장', () => {
  it('비밀번호 저장 시 발송 대상이 없거나 허용값 밖이면 400, RPC는 호출되지 않는다', async () => {
    expect((await patch({ locker_password: '1234', locker_number: '5' })).status).toBe(400)
    expect((await patch({ locker_password: '1234', locker_number: '5', locker_guide_legs: 'x' })).status).toBe(400)
    expect((await patch({ locker_password: '1234', locker_number: '5', locker_guide_legs: '' })).status).toBe(400)
    expect(rpcCalls).toEqual([])
  })

  it('유효한 발송 대상 3종은 그대로 RPC(p_legs)로 전달된다', async () => {
    for (const legs of ['pickup', 'return', 'both']) {
      expect((await patch({ locker_password: '1234', locker_number: '5', locker_guide_legs: legs })).status).toBe(200)
    }
    expect(rpcCalls.map((c) => c.args.p_legs)).toEqual(['pickup', 'return', 'both'])
    expect(rpcCalls.every((c) => c.fn === 'update_reservation_locker_password' && c.args.p_password === '1234' && c.args.p_locker_number === '5')).toBe(true)
  })

  it('삭제(번호·비밀번호 둘 다 비움)는 발송 대상 없이도 되고 p_legs=null', async () => {
    expect((await patch({ locker_password: '', locker_number: '' })).status).toBe(200)
    expect(rpcCalls[0].args).toMatchObject({ p_password: null, p_locker_number: null, p_legs: null })
  })
})

describe('A3 조회', () => {
  const get = async (): Promise<Record<string, unknown>> => {
    const res = await GET({ params: { id: '5' }, locals } as unknown as Parameters<typeof GET>[0])
    return res.json()
  }
  it('비밀번호가 있으면 저장된 발송 대상을 그대로 내려준다', async () => {
    dbRow = { locker_password: '1234', locker_number: '5', locker_guide_legs: 'return' }
    expect(await get()).toEqual({ locker_password: '1234', locker_number: '5', locker_guide_legs: 'return' })
  })
  it('비밀번호가 없으면 남아 있는 발송 대상 값은 내려주지 않는다', async () => {
    dbRow = { locker_password: null, locker_number: null, locker_guide_legs: 'both' }
    expect((await get()).locker_guide_legs).toBeNull()
  })
  it('옛 저장분(발송 대상 NULL)은 NULL 그대로 → 화면은 아무것도 선택하지 않은 상태', async () => {
    dbRow = { locker_password: '1234', locker_number: '5', locker_guide_legs: null }
    expect((await get()).locker_guide_legs).toBeNull()
  })
})

describe('A4 시범 발송', () => {
  const resvRow = { locker_password: null, locker_number: null, status: 'confirmed', products: { name: '카메라' } }
  const post = async (body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await POST({ params: { id: String(Math.floor(Math.random() * 1e9) + 10) }, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), locals } as unknown as Parameters<typeof POST>[0])
    return { status: res.status, json: await res.json() }
  }

  it('발송 대상을 고르지 않으면 400 — 문자는 나가지 않는다', async () => {
    dbRow = resvRow
    const r = await post({ locker_password: '1234', locker_number: '5' })
    expect(r.status).toBe(400)
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it('수령만 → 1통, 반납만 → 1통, 둘 다 → 수령·반납 순서로 2통', async () => {
    dbRow = resvRow
    const a = await post({ locker_password: '1234', locker_number: '5', locker_guide_legs: 'pickup' })
    expect(a.status).toBe(200)
    expect(sendSmsMock.mock.calls.map((c) => c[1])).toEqual(['[크레이지샷] 문장-pickup'])
    sendSmsMock.mockClear()
    await post({ locker_password: '1234', locker_number: '5', locker_guide_legs: 'return' })
    expect(sendSmsMock.mock.calls.map((c) => c[1])).toEqual(['[크레이지샷] 문장-return'])
    sendSmsMock.mockClear()
    const both = await post({ locker_password: '1234', locker_number: '5', locker_guide_legs: 'both' })
    expect(sendSmsMock.mock.calls.map((c) => c[1])).toEqual(['[크레이지샷] 문장-pickup', '[크레이지샷] 문장-return'])
    expect(String(both.json.message)).toContain('문장-pickup')
    expect(String(both.json.message)).toContain('문장-return')
    expect((both.json.messages as Array<{ leg: string }>).map((m) => m.leg)).toEqual(['pickup', 'return'])
  })
})
