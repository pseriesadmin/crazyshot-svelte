import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/checkout/cancel-inquiry — 배송형 배송 당일 09시 이후(또는 반출 후) 고객 "취소문의" (2026-10-26)
 *  - 고객 발신 'cancel_inquiry' 대화카드를 고객 채팅 세션에 남긴다(고객·관리자 양쪽 노출)
 *  - 예약 상태·결제·취소 표식은 변경하지 않는다
 *  - 서버가 inquiry 구간인지 재판정(09시 전 free → 409, 비배송형·불가 구간 → 403)
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
const mockPush = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({ sendPushToAdmins: (...a: unknown[]) => mockPush(...a) }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
}))

interface World {
  reservation: Record<string, unknown> | null
  orderItem: { order_id: number } | null
  methods: Array<{ method_key: string; is_delivery_type: boolean; deadline_time: string | null }>
  existingCards: Array<{ id: string }>
  rpcResult: { data: unknown; error: { message: string } | null }
  inserted: Array<Record<string, unknown>>
  updated: number
  rpcCalls: string[]
}
let world: World

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self; b.eq = self; b.in = self; b.is = self; b.order = self; b.limit = self; b.gte = self
      b.maybeSingle = async () => {
        if (table === 'rental_reservations') return { data: world.reservation, error: null }
        if (table === 'order_items') return { data: world.orderItem, error: null }
        return { data: null, error: null }
      }
      b.update = () => { world.updated++; return b }
      b.insert = async (row: Record<string, unknown>) => { world.inserted.push({ table, ...row }); return { error: null } }
      b.then = (resolve: (v: { data: unknown }) => void) => {
        if (table === 'rental_method_options') return resolve({ data: world.methods })
        if (table === 'chat_messages') return resolve({ data: world.existingCards })
        return resolve({ data: [] })
      }
      return b
    },
    rpc: async (fn: string) => { world.rpcCalls.push(fn); return world.rpcResult },
  }),
}))

const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min)
const METHODS = [
  { method_key: 'delivery', is_delivery_type: true, deadline_time: '예약일 2일 전 19:00까지 마감.' },
  { method_key: 'visit', is_delivery_type: false, deadline_time: '예약 대여일 1일 전 오후 7시까지' },
]

function resv(over: Record<string, unknown> = {}) {
  return {
    id: 42, status: 'confirmed', user_id: 'user-1', tracking_number: 'TRK1', pickup_method: 'delivery',
    start_date: '2026-10-29', end_date: '2026-10-30', reservation_code: 'CS2610001',
    products: { name: 'Sony FX3' }, ...over,
  }
}
const locals = (uid: string | null = 'user-1') => ({
  safeGetSession: vi.fn().mockResolvedValue({ session: uid ? { user: { id: uid } } : null }),
})
const req = (body: Record<string, unknown>) => ({ json: () => Promise.resolve(body) })

describe('POST /api/checkout/cancel-inquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(kst(2026, 10, 29, 10, 0)) // 배송 당일 09시가 지난 시점
    world = {
      reservation: resv(), orderItem: null, methods: METHODS, existingCards: [],
      rpcResult: { data: 'session-uuid', error: null }, inserted: [], updated: 0, rpcCalls: [],
    }
  })
  afterEach(() => { vi.useRealTimers() })

  async function call(l = locals(), body: Record<string, unknown> = { reservationId: 42 }) {
    const { POST } = await import('../../routes/api/checkout/cancel-inquiry/+server')
    return await POST({ locals: l, request: req(body) } as never) as { status: number; json: () => Promise<Record<string, unknown>> }
  }

  it('CI-1 세션 없음 → 401', async () => {
    expect((await call(locals(null))).status).toBe(401)
  })
  it('CI-2 예약 ID가 올바르지 않으면 400', async () => {
    expect((await call(locals(), { reservationId: 'x' })).status).toBe(400)
  })
  it('CI-3 타인 소유 예약 → 403, 카드 미발송', async () => {
    world.reservation = resv({ user_id: 'other' })
    expect((await call()).status).toBe(403)
    expect(world.inserted).toHaveLength(0)
  })
  it('CI-4 배송형 09시 이후 → 고객 발신 cancel_inquiry 카드 + 관리자 푸시, 예약·결제·표식 미변경', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(world.inserted).toHaveLength(1)
    const card = world.inserted[0] as { table: string; sender_type: string; message_type: string; session_id: string; content: string; action_payload: Record<string, unknown> }
    expect(card.table).toBe('chat_messages')
    expect(card.sender_type).toBe('user')
    expect(card.message_type).toBe('action_card')
    expect(card.session_id).toBe('session-uuid')
    expect(card.content).toContain('취소 문의')
    expect(card.action_payload).toMatchObject({ type: 'cancel_inquiry', reservation_id: '42', reservation_no: 'CS2610001', product_name: 'Sony FX3' })
    expect(card.action_payload.admin_only).toBeUndefined()
    expect(world.updated).toBe(0)
    // 취소 요청 표식 RPC(request_customer_cancel)는 호출하지 않는다 — 문의는 상태·표식을 바꾸지 않음
    expect(world.rpcCalls).not.toContain('request_customer_cancel')
    expect(mockPush).toHaveBeenCalledTimes(1)
  })
  it('CI-5 반출중(shipped) 배송형도 문의 접수', async () => {
    world.reservation = resv({ status: 'shipped' })
    vi.setSystemTime(kst(2026, 10, 29, 8, 0)) // 09시 전이어도 shipped 는 inquiry
    expect((await call()).status).toBe(200)
    expect(world.inserted).toHaveLength(1)
  })
  it('CI-6 배송 당일 09시 전(free) → 409 use_cancel, 카드 미발송', async () => {
    vi.setSystemTime(kst(2026, 10, 29, 8, 30))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('use_cancel')
    expect(world.inserted).toHaveLength(0)
  })
  it('CI-7 신청대기(hold) → 409, 비배송형·대여중 이후 → 403', async () => {
    world.reservation = resv({ status: 'hold' })
    expect((await call()).status).toBe(409)
    world.reservation = resv({ pickup_method: 'visit', tracking_number: null, start_date: '2026-10-29' })
    expect((await call()).status).toBe(403)
    world.reservation = resv({ status: 'in_use' })
    expect((await call()).status).toBe(403)
    expect(world.inserted).toHaveLength(0)
  })
  it('CI-8 24시간 안 중복 문의 → 새 카드 없이 duplicate 로 성공', async () => {
    world.existingCards = [{ id: 'card-1' }]
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true })
    expect(world.inserted).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalled()
  })
  it('CI-9 세션 확보 실패 → 500, 카드 미발송', async () => {
    world.rpcResult = { data: null, error: { message: 'boom' } }
    expect((await call()).status).toBe(500)
    expect(world.inserted).toHaveLength(0)
  })
})
