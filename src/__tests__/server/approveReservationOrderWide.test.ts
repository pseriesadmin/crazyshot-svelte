import { describe, it, expect, vi, beforeEach } from 'vitest'
// 1c: rental.reservation 메뉴 권한 게이트는 rentalMenuGuard.test.ts에서 따로 검증 — 여기서는 통과로 고정하고 핸들러 자체 로직만 본다
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))

/**
 * TDD — approveReservation 액션: 주문 1건 = 목록 1행(Migration 618) — 대표 행 승인 시 같은 주문의
 * 신청대기(hold) 형제 상품도 함께 승인한다.
 *
 * 완료기준(B-START):
 *   정상 동작   : 대표 예약을 승인하면 같은 주문의 hold 형제가 모두 update_reservation_status('confirmed') 된다.
 *   막아야 할 것 : hold가 아닌 형제(취소·만료·이미 confirmed 등)는 건드리지 않는다. 주문에 속하지 않은 예약은
 *                형제 조회 없이 자기 자신만 승인한다.
 *   실패했을 때  : 형제 승인이 실패해도 대표 승인 결과·알림 흐름을 막지 않는다(fail-soft).
 *
 * 대상: src/routes/cms/reservation/+page.server.ts approveReservation
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => ({ status, location }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))

const mockRpc = vi.fn()

interface Tables {
  orderOf: Record<number, number | null>          // reservation_id -> order_id
  itemsOfOrder: Record<number, number[]>          // order_id -> reservation_ids
  holdIds: number[]                               // status='hold'인 예약 id
}
let tables: Tables = { orderOf: {}, itemsOfOrder: {}, holdIds: [] }

// from('order_items') / from('rental_reservations') 최소 체인 모킹
function makeFrom(table: string) {
  const filters: Record<string, unknown> = {}
  let selected = ''
  const builder = {
    select: (cols: string) => { selected = cols; return builder },
    eq: (k: string, v: unknown) => { filters[k] = v; return builder },
    in: (k: string, v: unknown) => { filters[k] = v; return builder },
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (table === 'order_items' && selected === 'order_id') {
        const rid = filters['reservation_id'] as number
        const orderId = tables.orderOf[rid] ?? null
        return { data: orderId == null ? null : { order_id: orderId }, error: null }
      }
      return { data: null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) => {
      let data: unknown[] = []
      if (table === 'order_items' && selected === 'reservation_id') {
        const ids = tables.itemsOfOrder[filters['order_id'] as number] ?? []
        data = ids.map((id) => ({ reservation_id: id }))
      } else if (table === 'rental_reservations' && selected === 'id') {
        const inIds = (filters['id'] as number[]) ?? []
        data = inIds.filter((id) => tables.holdIds.includes(id)).map((id) => ({ id }))
      }
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: (t: string) => makeFrom(t) }),
}))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))
vi.mock('$lib/server/dhero', () => ({
  createDelivery: vi.fn(), cancelDelivery: vi.fn(), registerReturn: vi.fn(),
  DHERO_STATUS_LABEL: {},
  DheroApiError: class DheroApiError extends Error {},
  DheroNetworkError: class DheroNetworkError extends Error {},
}))
vi.mock('$lib/server/getReservationForDhero', () => ({ getReservationForDhero: vi.fn() }))
vi.mock('$lib/server/isBulkDeliveryMethod', () => ({ isBulkDeliveryMethod: vi.fn() }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined) }))
const mockResolvePlan = vi.fn()
vi.mock('$lib/server/reservationApprovalNotify', () => ({
  resolveApprovalNotifyPlan: (...args: unknown[]) => mockResolvePlan(...args),
}))
const mockSendApproval = vi.fn()
vi.mock('$lib/server/sendApprovalNotifications', () => ({
  sendApprovalNotifications: (...args: unknown[]) => mockSendApproval(...args),
}))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({
  clearIssuedContractContent: vi.fn(), discardSentContract: vi.fn(), cancelIssuedContract: vi.fn(),
}))
vi.mock('$lib/utils/cmsPermissions', () => ({ hasSettingsAccess: () => true }))

function makeFormData(values: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(values).forEach(([k, v]) => fd.append(k, v))
  return fd
}
function makeLocals() {
  return { safeGetSession: async () => ({ session: { user: { id: 'admin-uid' } } }), supabase: { rpc: vi.fn() } }
}

async function approve(reservationId: number) {
  const { actions } = await import('../../routes/cms/reservation/+page.server')
  return actions.approveReservation({
    request: { formData: async () => makeFormData({ reservation_id: String(reservationId) }) },
    locals: makeLocals(),
  } as never)
}

function approvedIds(): number[] {
  return mockRpc.mock.calls
    .filter(([fn, args]) => fn === 'update_reservation_status' && (args as { p_new_status: string }).p_new_status === 'confirmed')
    .map(([, args]) => (args as { p_reservation_id: number }).p_reservation_id)
}

describe('approveReservation — 주문 단위 일괄 승인(Migration 618)', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockResolvePlan.mockReset()
    mockSendApproval.mockReset()
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    mockResolvePlan.mockResolvedValue({ mode: 'single' })
    mockSendApproval.mockResolvedValue(undefined)
    tables = { orderOf: {}, itemsOfOrder: {}, holdIds: [] }
  })

  it('Happy: 대표(10) 승인 시 같은 주문의 hold 형제(11) 도 함께 승인된다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [10, 11] }
    const result = await approve(10)
    expect(result).toEqual({ ok: true })
    expect(approvedIds().sort()).toEqual([10, 11])
  })

  it('경계: hold가 아닌 형제(12, 이미 취소·만료 등)는 승인하지 않는다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11, 12] }, holdIds: [10, 11] }
    await approve(10)
    expect(approvedIds().sort()).toEqual([10, 11])
    expect(approvedIds()).not.toContain(12)
  })

  it('주문에 속하지 않은 단일 예약은 자기 자신만 승인한다', async () => {
    tables = { orderOf: {}, itemsOfOrder: {}, holdIds: [] }
    await approve(10)
    expect(approvedIds()).toEqual([10])
  })

  it('fail-soft: 형제 승인 RPC가 예외를 던져도 대표 승인은 성공으로 응답하고 알림 판단은 계속된다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [10, 11] }
    mockRpc.mockImplementation(async (_fn: string, args: { p_reservation_id: number }) => {
      if (args.p_reservation_id === 11) throw new Error('boom')
      return { data: { ok: true }, error: null }
    })
    const result = await approve(10)
    expect(result).toEqual({ ok: true })
    expect(mockResolvePlan).toHaveBeenCalledWith(expect.anything(), 10)
  })

  it('대표 승인 자체가 실패하면(ok:false) 형제는 건드리지 않고 400을 반환한다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [10, 11] }
    mockRpc.mockResolvedValue({ data: { ok: false, error: '처리 실패' }, error: null })
    const result = await approve(10)
    expect(result).toMatchObject({ status: 400 })
    expect(approvedIds()).toEqual([10])
  })

  it('M-1: 요청한 대표(10)가 이미 confirmed여도 주문 안의 hold 형제(11)를 승인한다(400으로 끝나지 않음)', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [11] }
    const result = await approve(10)
    expect(result).toEqual({ ok: true })
    expect(approvedIds()).toEqual([11])
    // 알림 판단은 실제로 승인된 예약(11) 기준
    expect(mockResolvePlan).toHaveBeenCalledWith(expect.anything(), 11)
  })

  it('주문 안에 hold가 하나도 없으면 요청 예약을 그대로 시도해 RPC의 에러를 돌려준다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [] }
    mockRpc.mockResolvedValue({ data: { ok: false, error: '이미 처리된 예약' }, error: null })
    const result = await approve(10)
    expect(result).toMatchObject({ status: 400 })
    expect(approvedIds()).toEqual([10])
  })
})
