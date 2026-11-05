// reservationCardApi.test.ts — /api/chat/sessions/[id]/reservation-card: 본인 세션 + 본인 예약일 때만 상담 시작 카드를 넣는다
// + ensureReservationCard: 예약 단위 중복 방지(같은 예약의 상담 카드만 막고, 다른 예약·상태 알림 카드는 막지 않음)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const mockEnsure = vi.fn()
vi.mock('$lib/server/chatReservationCard', () => ({ ensureReservationCard: (...a: unknown[]) => mockEnsure(...a) }))

let sessionRow: unknown = null
let ownedReservation: unknown = null
const ownerChecks: Array<Record<string, unknown>> = []

function builder(table: string) {
  const filters: Record<string, unknown> = {}
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => { filters[k] = v; return b },
    maybeSingle: async () => {
      if (table === 'chat_sessions') return { data: sessionRow }
      ownerChecks.push({ ...filters })
      return { data: ownedReservation }
    },
  }
  return b
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }))

const { POST } = await import('../../routes/api/chat/sessions/[id]/reservation-card/+server')

function call(opts: { session?: unknown; body?: unknown; badBody?: boolean }) {
  return POST({
    params: { id: 'sess-1' },
    locals: { safeGetSession: vi.fn().mockResolvedValue({ session: opts.session === undefined ? { user: { id: 'u1' } } : opts.session }) },
    request: { json: async () => { if (opts.badBody) throw new Error('bad'); return opts.body } },
  } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<{ status: number; data: Record<string, unknown> }>
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionRow = { user_id: 'u1', context_type: 'general', context_reservation_id: null }
  ownedReservation = { id: 364 }
  ownerChecks.length = 0
})

describe('POST reservation-card', () => {
  it('로그인하지 않았으면 401', async () => {
    expect((await call({ session: null })).status).toBe(401)
    expect(mockEnsure).not.toHaveBeenCalled()
  })
  it('남의 세션이면 403', async () => {
    sessionRow = { user_id: 'someone-else', context_type: 'general', context_reservation_id: null }
    expect((await call({ body: { reservation_id: 364 } })).status).toBe(403)
    expect(mockEnsure).not.toHaveBeenCalled()
  })
  it('본인 예약이면 일반 세션에 카드를 넣는다(예약 소유 확인은 user_id 조건 포함)', async () => {
    const res = await call({ body: { reservation_id: 364 } })
    expect(res.status).toBe(200)
    expect(mockEnsure).toHaveBeenCalledWith(expect.anything(), 'sess-1', 364)
    expect(ownerChecks[0]).toMatchObject({ id: 364, user_id: 'u1' })
  })
  it('남의 예약 번호면 카드를 넣지 않는다', async () => {
    ownedReservation = null
    const res = await call({ body: { reservation_id: 999 } })
    expect(res.status).toBe(200)
    expect(mockEnsure).not.toHaveBeenCalled()
  })
  it('예약 번호가 문자열·0·음수·소수·null 이면 카드를 넣지 않는다', async () => {
    for (const bad of ['abc', 0, -1, 1.5, null]) {
      await call({ body: { reservation_id: bad } })
    }
    expect(mockEnsure).not.toHaveBeenCalled()
  })
  it('본문이 깨졌으면 아무것도 안 하고 ok', async () => {
    const res = await call({ badBody: true })
    expect(res.data).toMatchObject({ ok: true })
    expect(mockEnsure).not.toHaveBeenCalled()
  })
  it('구 예약 전용 세션은 본문과 무관하게 세션에 저장된 예약 번호로 카드를 넣는다', async () => {
    sessionRow = { user_id: 'u1', context_type: 'reservation', context_reservation_id: 77 }
    await call({ body: { reservation_id: 364 } })
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith(expect.anything(), 'sess-1', 77)
  })
})
