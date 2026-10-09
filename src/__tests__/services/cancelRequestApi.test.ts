import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/checkout/cancel-request — 마감 후 ~ 대여 시작 전(②구간) 고객 취소 요청
 *  - 고객 발신 'cancel_request' 대화카드를 고객 채팅 세션에 남긴다(관리자·고객 양쪽 노출)
 *  - 예약 상태·결제는 변경하지 않는다(관리자 수동 처리)
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
const mockPush = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({ sendPushToAdmins: (...a: unknown[]) => mockPush(...a) }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data },
  }),
}))

interface World {
  reservation: Record<string, unknown> | null
  orderItem: { order_id: number } | null
  methods: Array<{ method_key: string; is_delivery_type: boolean; deadline_time: string | null }>
  existingCards: Array<{ id: string }>
  rpcResult: { data: unknown; error: { message: string } | null }
  inserted: Array<Record<string, unknown>>
  updated: number
}
let world: World

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self; b.eq = self; b.in = self; b.is = self; b.order = self; b.limit = self
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
    rpc: async () => world.rpcResult,
  }),
}))

const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min)
const METHODS = [{ method_key: 'visit', is_delivery_type: false, deadline_time: '예약 대여일 1일 전 오후 7시까지' }]

function resv(over: Record<string, unknown> = {}) {
  return {
    id: 42, status: 'confirmed', user_id: 'user-1', tracking_number: null, pickup_method: 'visit',
    start_date: '2026-10-02', end_date: '2026-10-03', reservation_code: 'CS2610001',
    products: { name: 'Sony FX3' }, ...over,
  }
}
const locals = (uid: string | null = 'user-1') => ({
  safeGetSession: vi.fn().mockResolvedValue({ session: uid ? { user: { id: uid } } : null }),
})
const req = (body: Record<string, unknown>) => ({ json: () => Promise.resolve(body) })

describe('POST /api/checkout/cancel-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(kst(2026, 10, 1, 19, 30)) // 방문(1일 전 19시) 마감이 30분 지난 시점
    world = {
      reservation: resv(), orderItem: null, methods: METHODS, existingCards: [],
      rpcResult: { data: 'session-uuid', error: null }, inserted: [], updated: 0,
    }
  })
  afterEach(() => { vi.useRealTimers() })

  async function call(l = locals(), body: Record<string, unknown> = { reservationId: 42 }) {
    const { POST } = await import('../../routes/api/checkout/cancel-request/+server')
    return await POST({ locals: l, request: req(body) } as never) as { status: number; json: () => Promise<Record<string, unknown>> }
  }

  it('CR-1 세션 없음 → 401', async () => {
    expect((await call(locals(null))).status).toBe(401)
  })

  it('CR-2 예약 ID가 올바르지 않으면 400', async () => {
    expect((await call(locals(), { reservationId: 'x' })).status).toBe(400)
  })

  it('CR-3 타인 소유 예약 → 403, 카드 미발송', async () => {
    world.reservation = resv({ user_id: 'other' })
    expect((await call()).status).toBe(403)
    expect(world.inserted).toHaveLength(0)
  })

  it('CR-4 ②구간(마감 후·대여 시작 전) → 고객 발신 cancel_request 카드 발송 + 관리자 푸시, 예약·결제 미변경', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(world.inserted).toHaveLength(1)
    const card = world.inserted[0] as { table: string; sender_type: string; message_type: string; session_id: string; content: string; action_payload: Record<string, unknown> }
    expect(card.table).toBe('chat_messages')
    expect(card.sender_type).toBe('user') // 고객이 보낸 카드 — 고객 본인 채팅창에도 "보낸 카드"로 노출
    expect(card.message_type).toBe('action_card')
    expect(card.session_id).toBe('session-uuid')
    expect(card.action_payload).toMatchObject({ type: 'cancel_request', reservation_id: '42', reservation_no: 'CS2610001', product_name: 'Sony FX3' })
    expect(card.action_payload.admin_only).toBeUndefined()
    expect(world.updated).toBe(0) // 상태·결제 변경 없음
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('CR-5 ①구간(마감 전)도 즉시 환불 없이 취소 요청으로 접수 → 카드 발송 (2026-10-09 통합)', async () => {
    world.reservation = resv({ start_date: '2099-12-31', end_date: '2099-12-31' })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(world.inserted).toHaveLength(1)
    expect(world.updated).toBe(0) // 상태·결제 변경 없음
  })

  it('CR-6 hold(신청대기)는 언제든 즉시 취소 가능 → 409', async () => {
    world.reservation = resv({ status: 'hold' })
    expect((await call()).status).toBe(409)
  })

  it('CR-7 ③구간(대여 시작일 이후) → 403 after_start, 카드 미발송', async () => {
    world.reservation = resv({ start_date: '2026-10-01', end_date: '2026-10-02' })
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('after_start')
    expect(world.inserted).toHaveLength(0)
  })

  it('CR-8 운송장 등록 후 → 403 unavailable', async () => {
    world.reservation = resv({ tracking_number: 'TRACK1' })
    expect((await call()).status).toBe(403)
    expect(world.inserted).toHaveLength(0)
  })

  it('CR-9 이미 접수된 요청 → 200 duplicate, 카드·푸시 재발송 없음', async () => {
    world.existingCards = [{ id: 'msg-1' }]
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).duplicate).toBe(true)
    expect(world.inserted).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('CR-10 채팅 세션 확보 실패 → 500, 카드 미발송', async () => {
    world.rpcResult = { data: null, error: { message: 'boom' } }
    const res = await call()
    expect(res.status).toBe(500)
    expect(world.inserted).toHaveLength(0)
  })

  it('CR-11 관리자 푸시 실패해도 접수는 성공(fail-soft)', async () => {
    mockPush.mockRejectedValueOnce(new Error('push down'))
    expect((await call()).status).toBe(200)
    expect(world.inserted).toHaveLength(1)
  })
})
