import { describe, it, expect, vi, beforeEach } from 'vitest'
// 1c: rental.reservation 메뉴 권한 게이트는 rentalMenuGuard.test.ts에서 따로 검증 — 여기서는 통과로 고정하고 핸들러 자체 로직만 본다
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))

/**
 * approveReservation 액션: 주문 1건 = 목록 1행(Migration 618) — 대표 행에서 '예약승인'을 누르면 같은 주문의 신청대기(hold) 형제 상품 전체가 대상이다.
 * 2026-10-15(Stephen 확정): '예약승인'은 예약을 확정(confirmed)하지 않는다 — 계약완료는 고객의 전자계약 서명 + 결제 후에만 자동 전환(§9).
 *   정상 동작   : 서류 미승인이면 같은 주문의 hold 형제 전부에 승인 요청 표식을 남긴다(서류 승인 시 자동 발행 대상).
 *   막아야 할 것 : 어떤 경우에도 update_reservation_status('confirmed')·승인 알림을 호출하지 않는다. hold가 아닌 형제·다른 주문은 건드리지 않는다.
 *   실패했을 때  : 신청대기 예약이 하나도 없으면 400.
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
const updates: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = []

// from('order_items') / from('rental_reservations') 최소 체인 모킹
function makeFrom(table: string) {
  const filters: Record<string, unknown> = {}
  let selected = ''
  const builder = {
    select: (cols: string) => { selected = cols; return builder },
    eq: (k: string, v: unknown) => { filters[k] = v; return builder },
    in: (k: string, v: unknown) => { filters[k] = v; return builder },
    is: () => builder,
    not: () => builder,
    update: (values: Record<string, unknown>) => { updates.push({ table, values, filters }); return builder },
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
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({ isDheroIntegrationMethod: vi.fn() }))
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
vi.mock('$lib/server/identityDocRequest', () => ({ requestIdentityDocRegistration: vi.fn(async () => ({ requested: true, reason: 'sent' })) }))

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

function markedIds(): number[] {
  const m = updates.find((u) => u.table === 'rental_reservations' && 'approve_requested_at' in u.values)
  return ((m?.filters['id'] as number[]) ?? []).slice().sort()
}

describe('approveReservation — 주문 단위 승인 요청(Migration 618·718, 확정하지 않음)', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockResolvePlan.mockReset()
    mockSendApproval.mockReset()
    updates.length = 0
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    tables = { orderOf: {}, itemsOfOrder: {}, holdIds: [] }
  })

  it('Happy: 대표(10)에서 예약승인 → 같은 주문의 hold 형제(11)까지 승인 요청 표식을 남기고 확정하지는 않는다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [10, 11] }
    const result = await approve(10)
    expect(result).toMatchObject({ ok: true, identityRequested: true })
    expect(markedIds()).toEqual([10, 11])
    expect(approvedIds()).toEqual([])
    expect(mockSendApproval).not.toHaveBeenCalled()
  })

  it('경계: hold가 아닌 형제(12, 이미 취소·만료 등)에는 표식을 남기지 않는다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11, 12] }, holdIds: [10, 11] }
    await approve(10)
    expect(markedIds()).toEqual([10, 11])
  })

  it('주문에 속하지 않은 단일 예약은 자기 자신만 대상이다', async () => {
    tables = { orderOf: {}, itemsOfOrder: {}, holdIds: [10] }
    await approve(10)
    expect(markedIds()).toEqual([10])
    expect(approvedIds()).toEqual([])
  })

  it('요청한 대표(10)가 이미 hold가 아니어도 주문 안의 hold 형제(11)가 대상이다(400으로 끝나지 않음)', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10, 11] }, holdIds: [11] }
    const result = await approve(10)
    expect(result).toMatchObject({ ok: true })
    expect(markedIds()).toEqual([11])
  })

  it('주문 안에 hold가 하나도 없으면 400 — 확정 RPC를 시도하지 않는다', async () => {
    tables = { orderOf: { 10: 45 }, itemsOfOrder: { 45: [10] }, holdIds: [] }
    const result = await approve(10)
    expect(result).toMatchObject({ status: 400 })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('updateStatus — 서명·결제 없는 계약완료 직접 전환 차단', () => {
  it("status='confirmed' 요청은 400으로 거절하고 RPC를 부르지 않는다", async () => {
    mockRpc.mockReset()
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    const { actions } = await import('../../routes/cms/reservation/+page.server')
    const r = await actions.updateStatus({
      request: { formData: async () => makeFormData({ reservation_id: '10', status: 'confirmed' }) },
      locals: makeLocals(),
    } as never)
    expect(r).toMatchObject({ status: 400 })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
