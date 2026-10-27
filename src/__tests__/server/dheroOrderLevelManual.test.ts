import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 두발히어로 수동 접수·취소·반품 접수 — 예약코드(주문) 1건 = 배송 1건 (2026-10-27, Stephen 확정)
 *
 * MB-1  수동 배송접수: 같은 주문의 상품 전부를 한 건으로 접수(상품명 합침) + 접수번호를 상품 전부에 저장 + 고객 안내 1회
 * MB-2  주문의 어느 상품에든 접수번호가 이미 있으면 409(중복 접수 차단), 접수 미호출
 * MB-3  주문에 묶이지 않은 예약은 기존과 같이 자기 자신만
 * MB-4  취소: 취소 호출 1회 + 같은 접수번호를 가진 상품 전부의 운송장 초기화(다른 번호·없는 상품은 건드리지 않음)
 * MB-5  반품 접수: 호출 1회 + 같은 접수번호를 가진 상품 전부에 반품번호 저장
 * MB-6  형제 조회가 실패해도 요청한 예약은 처리한다(fail-soft)
 * MB-7  두발히어로 쪽에서 취소된 접수(dhero_meta.canceledAt)는 409 로 막지 않고 재접수한다
 */

vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
}))

interface Unit { id: number; tracking_number: string | null; canceledAt?: string }
let orderId: number | null = 77
let units: Unit[] = []
let siblingLookupFails = false
const mockRpc = vi.fn()

function builder(table: string) {
  const st = { filters: [] as Array<[string, unknown]> }
  const resolve = (single: boolean) => {
    if (table === 'order_items') {
      if (siblingLookupFails) throw new Error('lookup failed')
      if (single) return { data: orderId == null ? null : { order_id: orderId }, error: null }
      return { data: orderId == null ? [] : units.map((u) => ({ reservation_id: u.id })), error: null }
    }
    if (table === 'rental_reservations') {
      const inF = st.filters.find(([k]) => k === 'in')
      const eqF = st.filters.find(([k]) => k === 'eq')
      if (single) {
        const u = units.find((x) => x.id === eqF?.[1])
        return { data: u ? { tracking_number: u.tracking_number } : null, error: null }
      }
      const ids = Array.isArray(inF?.[1]) ? (inF?.[1] as number[]) : units.map((u) => u.id)
      return { data: units.filter((u) => ids.includes(u.id)), error: null }
    }
    return { data: single ? null : [], error: null }
  }
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (_k: string, v: unknown) => { st.filters.push(['eq', v]); return b }
  b.in = (_k: string, v: unknown) => { st.filters.push(['in', v]); return b }
  b.maybeSingle = async () => resolve(true)
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    try { return Promise.resolve(resolve(false)).then(res, rej) } catch (e) { return Promise.reject(e).then(res, rej) }
  }
  return b
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockRpc, from: (t: string) => builder(t) }) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn().mockResolvedValue('manager') }))
vi.mock('$lib/utils/cmsPermissions', () => ({ hasSettingsAccess: () => true }))

const mockCreateDelivery = vi.fn()
const mockCancelDelivery = vi.fn()
const mockRegisterReturn = vi.fn()
class MockDheroApiError extends Error { statusCode: number; constructor(m: string, s: number) { super(m); this.statusCode = s } }
vi.mock('$lib/server/dhero', () => ({
  createDelivery: (...a: unknown[]) => mockCreateDelivery(...a),
  cancelDelivery: (...a: unknown[]) => mockCancelDelivery(...a),
  registerReturn: (...a: unknown[]) => mockRegisterReturn(...a),
  getDeliveryByBookId: vi.fn(),
  DHERO_STATUS_LABEL: { 0: '접수' },
  DheroApiError: MockDheroApiError,
}))
vi.mock('$lib/server/dheroAutoAdvance', () => ({ maybeAutoAdvanceOnDheroDelivered: vi.fn() }))

const mockGetReservation = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({ getReservationForDhero: (...a: unknown[]) => mockGetReservation(...a) }))
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({ isDheroIntegrationMethod: vi.fn().mockResolvedValue(true) }))
const mockNotifyTracking = vi.fn()
vi.mock('$lib/server/notifyTrackingRegistered', () => ({ notifyTrackingRegistered: (...a: unknown[]) => mockNotifyTracking(...a) }))

const bookRes = (id: number) => ({
  reservationId: id, status: 'confirmed', pickupMethod: 'delivery', returnMethod: 'delivery',
  trackingNumber: units.find((u) => u.id === id)?.tracking_number ?? null, reservationCode: 'CS-ORD-77',
  courierCode: units.find((u) => u.id === id)?.tracking_number ? '두발히어로' : null,
  dheroMeta: units.find((u) => u.id === id)?.canceledAt ? { canceledAt: units.find((u) => u.id === id)?.canceledAt } : null,
  customerName: '홍길동', customerPhone: '010', address: '서울 강남구', addressDetail: '101호', postalCode: '06236',
  productName: id === 1 ? 'Sony FX3' : 'Manfrotto 055', notes: null,
})

const ctx = (id: number) => ({
  params: { id: String(id) },
  locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) },
  request: {} as Request,
  url: new URL('http://localhost'),
}) as never

const rpcCalls = (fn: string) => mockRpc.mock.calls.filter((c) => c[0] === fn)

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null })
  mockCreateDelivery.mockReset().mockResolvedValue({ bookId: 'BOOK-1', dongGroup: 'G1' })
  mockCancelDelivery.mockReset().mockResolvedValue(undefined)
  mockRegisterReturn.mockReset().mockResolvedValue({ bookId: 'R-1', dongGroup: 'G1' })
  mockNotifyTracking.mockReset().mockResolvedValue(undefined)
  mockGetReservation.mockReset().mockImplementation(async (_a: unknown, id: number) => bookRes(id))
  orderId = 77
  siblingLookupFails = false
  units = [{ id: 1, tracking_number: null }, { id: 2, tracking_number: null }]
})

describe('수동 두발히어로 접수·취소·반품 — 주문 단위', () => {
  it('MB-1: 수동 배송접수는 주문의 상품을 한 건으로 접수하고 접수번호를 전부에 저장한다', async () => {
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = (await POST(ctx(1))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    const arg = mockCreateDelivery.mock.calls[0][0] as { productName: string; orderIdFromCorp: string }
    expect(arg.productName).toBe('Sony FX3 + Manfrotto 055')
    expect(arg.orderIdFromCorp).toBe('CS-ORD-77')
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => [c[1].p_reservation_id, c[1].p_tracking_number])).toEqual([[1, 'BOOK-1'], [2, 'BOOK-1']])
    expect(mockNotifyTracking).toHaveBeenCalledTimes(1)
  })

  it('MB-2: 주문의 어느 상품에든 접수번호가 있으면 409 이고 접수하지 않는다', async () => {
    units = [{ id: 1, tracking_number: null }, { id: 2, tracking_number: 'BOOK-OLD' }]
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = (await POST(ctx(1))) as { status: number }
    expect(res.status).toBe(409)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
  })

  it('MB-3: 주문에 묶이지 않은 예약은 자기 자신만 접수한다', async () => {
    orderId = null
    units = [{ id: 1, tracking_number: null }]
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    await POST(ctx(1))
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    expect((mockCreateDelivery.mock.calls[0][0] as { productName: string }).productName).toBe('Sony FX3')
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => c[1].p_reservation_id)).toEqual([1])
  })

  it('MB-4: 취소는 한 번 호출하고 같은 접수번호를 가진 상품 전부의 운송장을 초기화한다', async () => {
    units = [{ id: 1, tracking_number: 'BOOK-1' }, { id: 2, tracking_number: 'BOOK-1' }, { id: 3, tracking_number: 'OTHER' }]
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    const res = (await PUT(ctx(1))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockCancelDelivery).toHaveBeenCalledTimes(1)
    expect(mockCancelDelivery).toHaveBeenCalledWith('BOOK-1')
    expect(rpcCalls('clear_reservation_tracking_number').map((c) => c[1].p_reservation_id)).toEqual([1, 2])
  })

  it('MB-5: 반품 접수는 한 번 호출하고 같은 접수번호를 가진 상품 전부에 반품번호를 저장한다', async () => {
    units = [{ id: 1, tracking_number: 'BOOK-1' }, { id: 2, tracking_number: 'BOOK-1' }]
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/return/+server')
    const res = (await POST(ctx(2))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockRegisterReturn).toHaveBeenCalledTimes(1)
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => [c[1].p_reservation_id, c[1].p_return_book_id])).toEqual([[1, 'R-1'], [2, 'R-1']])
  })

  it('MB-6: 형제 조회가 실패해도 요청한 예약은 초기화·저장된다', async () => {
    units = [{ id: 1, tracking_number: 'BOOK-1' }, { id: 2, tracking_number: 'BOOK-1' }]
    siblingLookupFails = true
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    await PUT(ctx(1))
    expect(rpcCalls('clear_reservation_tracking_number').map((c) => c[1].p_reservation_id)).toEqual([1])
  })

  it('MB-7: 두발히어로 쪽에서 취소된 접수(dhero_meta.canceledAt)는 409 로 막지 않고 재접수한다', async () => {
    units = [{ id: 1, tracking_number: 'BOOK-OLD', canceledAt: '2026-10-27 15:34:52' }, { id: 2, tracking_number: 'BOOK-OLD', canceledAt: '2026-10-27 15:34:52' }]
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = (await POST(ctx(1))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => [c[1].p_reservation_id, c[1].p_tracking_number])).toEqual([[1, 'BOOK-1'], [2, 'BOOK-1']])
  })

  it('MB-8: 형제 한쪽만 취소로 기록돼 있어도(다른 쪽 meta 지연) 같은 접수번호면 재접수가 409 로 막히지 않는다', async () => {
    units = [{ id: 1, tracking_number: 'BOOK-OLD', canceledAt: '2026-10-27 15:34:52' }, { id: 2, tracking_number: 'BOOK-OLD' }]
    const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = (await POST(ctx(2))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
  })
})
