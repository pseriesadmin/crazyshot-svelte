import { describe, it, expect, vi, beforeEach } from 'vitest'

/** /cms/rentals load — 고객 취소중 예약을 맨 위에 붙여도 총 건수·페이지 수는 원 목록 기준이어야 한다 (QA B-1) */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({ redirect: vi.fn(), fail: vi.fn() }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn() }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn() }))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({ clearIssuedContractContent: vi.fn() }))
vi.mock('$lib/server/rentalDaysLabel', () => ({ attachRentalDaysLabel: vi.fn().mockResolvedValue(undefined) }))

let pendingIds: number[] = []
let pendingError: { message: string } | null = null
const rpcCalls: Array<Record<string, unknown>> = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self; b.eq = self; b.not = self; b.is = self; b.order = self; b.limit = self
      b.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === 'rental_reservations') return resolve({ data: pendingError ? null : pendingIds.map(id => ({ id })), error: pendingError })
        return resolve({ data: [], error: null }) // cms_menu_permissions
      }
      return b
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, ...args })
      if (args.p_reservation_id != null) {
        return { data: [{ reservation_id: args.p_reservation_id, status: 'cancelled', total_count: 1 }], error: null } // 1건 조회 → total_count=1
      }
      return { data: [{ reservation_id: 1, status: 'confirmed', total_count: 45 }, { reservation_id: 2, status: 'confirmed', total_count: 45 }], error: null }
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

describe('/cms/rentals load — 취소중 예약 prepend', () => {
  beforeEach(() => { pendingIds = []; pendingError = null; rpcCalls.length = 0 })

  it('PC-1 취소중 예약을 붙여도 totalCount·totalPages는 원 목록(45건→2페이지) 기준', async () => {
    pendingIds = [901, 902]
    const r = await load('http://x/cms/rentals?status=') as { rentals: Array<{ reservation_id: number; cancel_pending?: boolean }>; totalCount: number; totalPages: number }
    expect(r.totalCount).toBe(45)
    expect(r.totalPages).toBe(2)
    expect(r.rentals.map(x => x.reservation_id)).toEqual([901, 902, 1, 2])
    expect(r.rentals.slice(0, 2).every(x => x.cancel_pending === true)).toBe(true)
    expect(r.rentals.slice(2).every(x => x.cancel_pending === undefined)).toBe(true)
  })

  it('PC-2 취소중 예약이 없으면 기존과 동일(추가 조회 없음)', async () => {
    const r = await load('http://x/cms/rentals?status=') as { rentals: unknown[]; totalCount: number }
    expect(r.rentals).toHaveLength(2)
    expect(r.totalCount).toBe(45)
    expect(rpcCalls.filter(c => c.p_reservation_id != null)).toHaveLength(0)
  })

  it('PC-3 반출중 등 다른 상태 칩·검색·2페이지에서는 취소중 행을 붙이지 않는다', async () => {
    pendingIds = [901]
    for (const u of ['http://x/cms/rentals?status=in_use', 'http://x/cms/rentals?status=&search=abc', 'http://x/cms/rentals?status=&page=2']) {
      const r = await load(u) as { rentals: Array<{ cancel_pending?: boolean }> }
      expect(r.rentals.some(x => x.cancel_pending)).toBe(false)
    }
  })

  it('PC-4 취소중 조회가 실패해도 로드는 계속되고(원 목록 유지) 오류를 로그로 남긴다', async () => {
    pendingError = { message: 'db down' }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await load('http://x/cms/rentals?status=') as { rentals: unknown[]; totalCount: number }
    expect(r.rentals).toHaveLength(2)
    expect(r.totalCount).toBe(45)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
