import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 고객 "예약신청취소" — 주문 1건 = 취소 1건 (2026-10-26)
 * 상품이 여러 개 담긴 하나의 예약코드는 통째로 취소된다(신청대기 경로).
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/cancelRequest', () => ({ submitCancelRequest: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: vi.fn() }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
}))

interface Res { id: number; status: string; user_id: string }
let reservations: Res[] = []
let orderItems: Array<{ order_id: number; reservation_id: number }> = []
let orderOwner = 'user-1'
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
let failIds = new Set<number>()

function table(name: string) {
  const filters: Array<[string, unknown]> = []
  let inCol: [string, unknown[]] | null = null
  const rows = (): Array<Record<string, unknown>> => {
    let r: Array<Record<string, unknown>> =
      name === 'rental_reservations' ? reservations.map(x => ({ ...x, tracking_number: null, pickup_method: null, start_date: '2099-12-31', pickup_time: null }))
      : name === 'order_items' ? orderItems.map(x => ({ ...x }))
      : name === 'orders' ? [{ id: 10323, user_id: orderOwner }]
      : []
    for (const [k, v] of filters) r = r.filter(x => x[k] === v)
    if (inCol) { const [k, vals] = inCol; r = r.filter(x => vals.includes(x[k])) }
    return r
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
    in: (k: string, vals: unknown[]) => { inCol = [k, vals]; return q },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (n: string) => table(n),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'update_reservation_status') {
        return { data: failIds.has(args.p_reservation_id as number) ? { ok: false, error: '실패' } : { ok: true }, error: null }
      }
      return { data: null, error: null }
    },
  }),
}))

const locals = (uid = 'user-1') => ({ safeGetSession: async () => ({ session: { user: { id: uid } } }) })
const req = (id: number) => ({ json: async () => ({ reservationId: id }) })
const statusCalls = () => rpcCalls.filter(c => c.fn === 'update_reservation_status').map(c => c.args.p_reservation_id)
const marked = () => rpcCalls.find(c => c.fn === 'mark_customer_cancelled')?.args.p_reservation_ids as number[] | undefined

beforeEach(() => {
  vi.clearAllMocks()
  rpcCalls.length = 0
  failIds = new Set()
  orderOwner = 'user-1'
  reservations = [
    { id: 53822, status: 'hold', user_id: 'user-1' },
    { id: 54542, status: 'hold', user_id: 'user-1' },
  ]
  orderItems = [{ order_id: 10323, reservation_id: 53822 }, { order_id: 10323, reservation_id: 54542 }]
})

describe('신청대기 취소 — 주문 전체가 한 번에 취소', () => {
  it('WO-1 어느 카드에서 취소해도 같은 주문의 신청대기 행이 전부 취소·표식', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const res = await POST({ locals: locals(), request: req(53822) } as never) as { status: number }
    expect(res.status).toBe(200)
    expect(statusCalls().sort()).toEqual([53822, 54542])
    expect((marked() ?? []).sort()).toEqual([53822, 54542])
  })

  it('WO-1b 취소 알림은 주문 전체에 대해 대표(요청) 예약 id로 1번만 간다', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const { sendReservationLifecyclePush } = await import('$lib/server/push')
    await POST({ locals: locals(), request: req(53822) } as never)
    const chat = rpcCalls.filter(c => c.fn === 'send_rental_chat_notification')
    expect(chat).toHaveLength(1)
    expect(chat[0].args.p_reservation_id).toBe(53822)
    expect(sendReservationLifecyclePush).toHaveBeenCalledTimes(1)
  })

  it('WO-2 이미 취소·만료된 행은 다시 건드리지 않는다', async () => {
    reservations[1].status = 'cancelled'
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    await POST({ locals: locals(), request: req(53822) } as never)
    expect(statusCalls()).toEqual([53822])
  })

  it('WO-2b 만료(expired)·계약완료(confirmed) 등 신청대기가 아닌 행도 건드리지 않는다', async () => {
    reservations.push({ id: 54543, status: 'expired', user_id: 'user-1' }, { id: 54544, status: 'confirmed', user_id: 'user-1' })
    orderItems.push({ order_id: 10323, reservation_id: 54543 }, { order_id: 10323, reservation_id: 54544 })
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    await POST({ locals: locals(), request: req(53822) } as never)
    expect(statusCalls().sort()).toEqual([53822, 54542])
    expect(marked()).not.toContain(54543)
    expect(marked()).not.toContain(54544)
  })

  it('WO-3 다른 주문의 예약은 취소되지 않는다', async () => {
    reservations.push({ id: 60000, status: 'hold', user_id: 'user-1' })
    orderItems.push({ order_id: 99999, reservation_id: 60000 })
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    await POST({ locals: locals(), request: req(53822) } as never)
    expect(statusCalls()).not.toContain(60000)
  })

  it('WO-4 타인 소유 행은 취소 대상에서 제외, 타인 주문은 403', async () => {
    reservations[1].user_id = 'other-user'
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    await POST({ locals: locals(), request: req(53822) } as never)
    expect(statusCalls()).toEqual([53822])

    rpcCalls.length = 0
    orderOwner = 'other-user'
    const res = await POST({ locals: locals(), request: req(53822) } as never) as { status: number }
    expect(res.status).toBe(403)
    expect(statusCalls()).toEqual([])
  })

  it('WO-5 중간에 실패하면 500, 이미 취소된 행만 표식(재시도로 수렴)', async () => {
    failIds = new Set([54542])
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const res = await POST({ locals: locals(), request: req(53822) } as never) as { status: number }
    expect(res.status).toBe(500)
    expect(marked()).toEqual([53822])
  })

  it('WO-6 주문에 묶이지 않은 단독 예약은 그 한 건만 취소', async () => {
    orderItems = []
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    await POST({ locals: locals(), request: req(53822) } as never)
    expect(statusCalls()).toEqual([53822])
  })
})
