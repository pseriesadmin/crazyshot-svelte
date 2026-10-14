import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/rentals '취소·환불' 칩(status=cancelled_refunded) — 2026-10-14
 * 정상: 칩은 취소된 예약 전부(get_rental_list p_status=cancelled) / 취소된 예약을 가리키는 링크는 칩 자동 전환 / 링크 예약이 1페이지에 없으면 따로 붙임 /
 *       고객 취소·관리자 확인 전 행은 취소중(cancel_pending) 유지.
 * 막아야할것: 이미 취소·환불 칩이면 리다이렉트 반복 금지, 취소 안 된 예약 링크는 전환하지 않음, 다른 칩 경로 무변경.
 */
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => { throw { status, location } },
  fail: vi.fn(),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn() }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn() }))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({ clearIssuedContractContent: vi.fn() }))
vi.mock('$lib/server/rentalDaysLabel', () => ({ attachRentalDaysLabel: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/resolveOrderRepresentative', () => ({ resolveRepresentativeReservationId: async (_a: unknown, id: number) => id }))

let selectedStatus: string | null = 'cancelled'
let pendingMarkIds: number[] = []
const rpcCalls: Array<Record<string, unknown>> = []
const listRows = [
  { reservation_id: 11, status: 'cancelled', payment_status: 'cancelled', total_count: 60 },
  { reservation_id: 12, status: 'cancelled', payment_status: null, total_count: 60 },
]

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self; b.eq = self; b.not = self; b.is = self; b.order = self; b.limit = self; b.in = self; b.neq = self
      b.maybeSingle = async () => ({ data: selectedStatus === null ? null : { status: selectedStatus }, error: null })
      b.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === 'rental_reservations') return resolve({ data: pendingMarkIds.map(id => ({ id })), error: null })
        return resolve({ data: [], error: null })
      }
      return b
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, ...args })
      if (args.p_reservation_id != null) return { data: [{ reservation_id: args.p_reservation_id, status: 'cancelled', total_count: 1 }], error: null }
      return { data: listRows.map(r => ({ ...r })), error: null }
    },
  }),
}))

async function load(url: string) {
  const { load } = await import('../../routes/cms/rentals/+page.server')
  return await (load as unknown as (a: unknown) => Promise<Record<string, unknown>>)({
    parent: async () => ({ cmsRole: 'manager', session: { user: { id: 'admin-1' } } }),
    url: new URL(url),
  })
}

describe('/cms/rentals — 취소·환불 칩', () => {
  beforeEach(() => { selectedStatus = 'cancelled'; pendingMarkIds = []; rpcCalls.length = 0 })

  it('CV-1 칩은 취소된 예약 전부를 조회한다(p_status=cancelled, 상태 범위=cancelled) — 총 건수는 원 목록 기준', async () => {
    const r = await load('http://x/cms/rentals?status=cancelled_refunded') as { rentals: unknown[]; totalCount: number; totalPages: number }
    const list = rpcCalls.find(c => c.p_reservation_id == null)
    expect(list?.p_status).toBe('cancelled')
    expect(list?.p_include_statuses).toEqual(['cancelled'])
    expect(list?.p_group_by_order).toBe(true)
    expect(r.totalCount).toBe(60)
    expect(r.totalPages).toBe(2)
  })

  it('CV-2 취소된 예약을 가리키는 링크는 칩으로 자동 전환(리다이렉트)', async () => {
    for (const u of ['http://x/cms/rentals?status=&selected=18976', 'http://x/cms/rentals?selected=18976', 'http://x/cms/rentals?status=confirmed&selected=18976']) {
      await expect(load(u)).rejects.toMatchObject({ status: 303, location: '/cms/rentals?status=cancelled_refunded&selected=18976' })
    }
  })

  it('CV-3 이미 취소·환불 칩이면 리다이렉트하지 않는다(반복 방지)', async () => {
    await expect(load('http://x/cms/rentals?status=cancelled_refunded&selected=11')).resolves.toBeTruthy()
  })

  it('CV-4 취소되지 않은 예약 링크는 전환하지 않는다', async () => {
    selectedStatus = 'confirmed'
    await expect(load('http://x/cms/rentals?status=&selected=500')).resolves.toBeTruthy()
  })

  it('CV-5 링크 예약이 1페이지 목록에 없으면 그 행만 따로 맨 위에 붙이고 총 건수는 그대로', async () => {
    const r = await load('http://x/cms/rentals?status=cancelled_refunded&selected=18976') as { rentals: Array<{ reservation_id: number }>; totalCount: number }
    expect(r.rentals[0].reservation_id).toBe(18976)
    expect(r.rentals.map(x => x.reservation_id)).toEqual([18976, 11, 12])
    expect(r.totalCount).toBe(60)
  })

  it('CV-6 링크 예약이 이미 1페이지에 있으면 중복 조회·중복 행 없음', async () => {
    const r = await load('http://x/cms/rentals?status=cancelled_refunded&selected=11') as { rentals: Array<{ reservation_id: number }> }
    expect(r.rentals.filter(x => x.reservation_id === 11)).toHaveLength(1)
    expect(rpcCalls.filter(c => c.p_reservation_id != null)).toHaveLength(0)
  })

  it('CV-7 고객 취소 후 관리자 확인 전 행은 취소중(cancel_pending)으로 표시된다', async () => {
    pendingMarkIds = [12]
    const r = await load('http://x/cms/rentals?status=cancelled_refunded') as { rentals: Array<{ reservation_id: number; cancel_pending?: boolean }> }
    expect(r.rentals.find(x => x.reservation_id === 12)?.cancel_pending).toBe(true)
    expect(r.rentals.find(x => x.reservation_id === 11)?.cancel_pending).toBeFalsy()
  })

  it('CV-8 다른 칩(계약완료)은 기존 조회 그대로(p_status=confirmed)', async () => {
    await load('http://x/cms/rentals?status=confirmed')
    const list = rpcCalls.find(c => c.p_reservation_id == null)
    expect(list?.p_status).toBe('confirmed')
    expect(list?.p_include_statuses).toEqual(['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed'])
  })
})
