import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))

/**
 * 수동 운송장 저장 → 같은 주문(예약코드)의 다른 상품에도 반영 (2026-11-27)
 *
 * T1  새 번호 저장 → 요청 예약 외 형제에 update_reservation_tracking 호출(대표 id 제외, 번호·택배사 동일)
 * T2  형제가 이미 같은 번호면 호출하지 않음
 * T3  번호를 비울 때: 직전 번호와 같은 형제만 비움 / 다른 번호·원래 빈 형제는 건드리지 않음 / 직전 번호 조회 실패 시 형제 미호출
 * T4  형제 RPC·조회가 실패해도 응답 200·success:true 유지(fail-soft), 고객 안내는 대표 기준 1회
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
  error: (status: number, message: string) => { const e = new Error(message) as Error & { status: number }; e.status = status; throw e },
}))

const mockAdminRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockAdminRpc, from: mockFrom }) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn().mockResolvedValue('manager') }))
const mockPush = vi.fn()
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: (...a: unknown[]) => mockPush(...a) }))

const { PATCH } = await import('../../routes/api/cms/reservations/[id]/tracking/+server')

const REP = 10
let repPrev: string | null = null
let siblings: { id: number; tracking_number: string | null }[] = []
let sibLookupError: { message: string } | null = null

function setupDb() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'rental_method_options') {
      return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { is_delivery_type: true }, error: null }) }) }) }) }
    }
    if (table === 'order_items') {
      return {
        select: () => ({
          eq: (col: string) => col === 'reservation_id'
            ? { maybeSingle: async () => ({ data: { order_id: 77 }, error: null }) }
            : Promise.resolve({ data: [{ reservation_id: REP }, ...siblings.map((s) => ({ reservation_id: s.id }))], error: null }),
        }),
      }
    }
    // rental_reservations: 대표 단건(eq→maybeSingle) 또는 형제 목록(in)
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { tracking_number: repPrev, pickup_method: 'delivery' }, error: null }) }),
        in: async () => ({ data: sibLookupError ? null : siblings, error: sibLookupError }),
      }),
    }
  })
}

function makeLocals(rpc = vi.fn().mockResolvedValue({ error: null })) {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'a' } } }), supabase: { rpc } }
}
const req = (body: Record<string, unknown>) => ({ json: vi.fn().mockResolvedValue(body) }) as unknown as Request
const call = (locals: ReturnType<typeof makeLocals>, body: Record<string, unknown>) =>
  PATCH({ params: { id: String(REP) }, request: req(body), locals } as never)
const trackingCalls = (rpc: ReturnType<typeof vi.fn>) =>
  rpc.mock.calls.filter((c) => c[0] === 'update_reservation_tracking').map((c) => c[1] as { p_reservation_id: number; p_tracking_number: string | null; p_courier_code: string | null })

beforeEach(() => {
  mockFrom.mockReset(); mockAdminRpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }); mockPush.mockReset().mockResolvedValue(undefined)
  repPrev = null; siblings = []; sibLookupError = null
  setupDb()
})

describe('PATCH tracking — 형제 상품 전파', () => {
  it('T1: 새 번호 저장 시 대표 외 형제 전부에 같은 번호·택배사를 저장한다', async () => {
    siblings = [{ id: 11, tracking_number: null }, { id: 12, tracking_number: 'OLD-1' }]
    const locals = makeLocals()
    const res = await call(locals, { tracking_number: 'NEW-9', courier_code: 'CJ' })
    expect(res.status).toBe(200)
    const calls = trackingCalls(locals.supabase.rpc as never)
    expect(calls.map((c) => c.p_reservation_id)).toEqual([REP, 11, 12])
    for (const c of calls) expect(c).toMatchObject({ p_tracking_number: 'NEW-9', p_courier_code: 'CJ' })
  })

  it('T2: 형제가 이미 같은 번호면 호출하지 않는다', async () => {
    siblings = [{ id: 11, tracking_number: 'NEW-9' }, { id: 12, tracking_number: null }]
    const locals = makeLocals()
    await call(locals, { tracking_number: 'NEW-9', courier_code: 'CJ' })
    expect(trackingCalls(locals.supabase.rpc as never).map((c) => c.p_reservation_id)).toEqual([REP, 12])
  })

  it('T3: 비울 때 직전 번호와 같은 형제만 비우고 다른 번호·원래 빈 형제는 건드리지 않는다', async () => {
    repPrev = 'SAME-1'
    siblings = [{ id: 11, tracking_number: 'SAME-1' }, { id: 12, tracking_number: 'OTHER-2' }, { id: 13, tracking_number: null }]
    const locals = makeLocals()
    await call(locals, { tracking_number: '', courier_code: '' })
    const calls = trackingCalls(locals.supabase.rpc as never)
    expect(calls.map((c) => c.p_reservation_id)).toEqual([REP, 11])
    expect(calls[1]).toMatchObject({ p_tracking_number: null, p_courier_code: null })
  })

  it('T3b: 직전 번호를 알 수 없으면(대표 조회 실패) 비우기는 대표만 처리하고 형제는 건드리지 않는다', async () => {
    siblings = [{ id: 11, tracking_number: 'SAME-1' }]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rental_reservations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error('lookup failed') } }), in: async () => ({ data: siblings, error: null }) }) }
      }
      return setupDbFallback(table)
    })
    const locals = makeLocals()
    const res = await call(locals, { tracking_number: '', courier_code: '' })
    expect(res.status).toBe(200)
    expect(trackingCalls(locals.supabase.rpc as never).map((c) => c.p_reservation_id)).toEqual([REP])
  })

  it('T4: 형제 RPC·형제 조회가 실패해도 200·success 를 유지하고 고객 안내는 대표 기준 1회다', async () => {
    siblings = [{ id: 11, tracking_number: null }, { id: 12, tracking_number: null }]
    const rpc = vi.fn().mockImplementation(async (_fn: string, args: { p_reservation_id: number }) =>
      ({ error: args.p_reservation_id === 11 ? { message: 'sibling rpc down' } : null }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(makeLocals(rpc), { tracking_number: 'NEW-9', courier_code: 'CJ' })
    expect(res.status).toBe(200)
    expect((await res.json() as { success: boolean }).success).toBe(true)
    expect(rpc.mock.calls.filter((c) => c[0] === 'update_reservation_tracking').length).toBe(3) // 11 실패해도 12까지 진행
    expect(mockAdminRpc.mock.calls.filter((c) => c[0] === 'send_rental_chat_notification').length).toBe(1)
    expect(mockPush).toHaveBeenCalledTimes(1)

    // 형제 조회 오류도 삼키되 로그를 남긴다
    sibLookupError = { message: 'lookup down' }
    const locals2 = makeLocals()
    const res2 = await call(locals2, { tracking_number: 'NEW-10', courier_code: 'CJ' })
    expect(res2.status).toBe(200)
    expect(trackingCalls(locals2.supabase.rpc as never).map((c) => c.p_reservation_id)).toEqual([REP])
    expect(spy.mock.calls.some((c) => String(c[0]).includes('tracking/sibling-lookup'))).toBe(true)
    spy.mockRestore()
  })
})

function setupDbFallback(table: string) {
  if (table === 'rental_method_options') {
    return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { is_delivery_type: true }, error: null }) }) }) }) }
  }
  return {
    select: () => ({
      eq: (col: string) => col === 'reservation_id'
        ? { maybeSingle: async () => ({ data: { order_id: 77 }, error: null }) }
        : Promise.resolve({ data: [{ reservation_id: REP }, ...siblings.map((s) => ({ reservation_id: s.id }))], error: null }),
    }),
  }
}
