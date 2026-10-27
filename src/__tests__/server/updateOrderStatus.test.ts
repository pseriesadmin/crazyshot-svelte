import { describe, it, expect, vi, beforeEach } from 'vitest'
// rental.reservation 메뉴 권한 게이트는 rentalMenuGuard.test.ts에서 따로 검증 — 여기서는 통과로 고정하고 액션 자체 로직만 본다
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))

/**
 * ④ 주문 단위 단일 처리 버튼 — updateOrderStatus 액션 (2026-10-27, Stephen 확정 "기본값대로 진행")
 * 한 주문의 상품들을 하단 버튼 하나로 다음 단계로 처리한다. 상품별 줄은 제거(모바일 QR 스캔은 상품별 처리 유지).
 *  OA-1  같은 주문의 상품 전부 전환, 고객 알림은 주문당 1회(대표 예약), 두발히어로 접수는 주문당 1회(상품명을 합쳐 한 건) + 같은 접수번호를 상품 전부에 저장
 *  OA-2  상태가 섞이면 가장 덜 진행된 단계의 상품만 처리하고 나머지는 건너뜀으로 알린다
 *  OA-3  일부만 실패하면 성공한 상품은 유지하고 실패한 상품을 알린다(롤백 없음) — 알림·두발히어로는 성공한 상품 기준
 *  OA-4  전부 실패하면 오류이고 알림·두발히어로는 호출하지 않는다
 *  OA-5  허용하지 않는 목표 단계(완료·취소·계약완료)는 400
 *  OA-6  주문에 묶이지 않은 예약은 자기 자신만 처리
 *  OA-7  두발히어로 연동이 꺼져 있으면 접수를 호출하지 않는다(알림은 그대로 1회)
 *  OA-8  접수가 실패해도 상태 전환은 유지되고 안내(dhero_book_failed)만 돌려준다(fail-soft)
 *  OA-9  반납 접수(return_requested): 반품 접수는 주문당 1회, 반품번호를 상품 전부에 저장
 *  OA-12 반납 접수: 대표 예약에 접수번호가 없으면 같은 주문 다른 상품의 접수번호 사용
 *  OA-13 접수 상품명 합침(×수량·500자 제한)
 *  OA-14 이미 접수번호가 있으면 출고 처리가 다시 접수하지 않음(중복 접수 방지)
 *  OA-15 대표 예약 자신의 접수번호만 있어도(단건 포함) 재접수하지 않음
 *  OA-16 건너뜀 안내: 두발히어로 접수번호면 조용히, 다른 택배사 운송장이면 dhero_book_failed 로 안내
 *  OA-17·18 반품 접수 거절(success=false)·예외 → 반품번호 미저장 + 관리자 안내(#9)
 *  OA-19 배송 접수 메모는 새 요청사항(pickupRequestNote) 우선(③)
 *  OA-20 두발히어로 쪽에서 취소된 접수번호는 접수됨으로 보지 않고 재접수\n *  OA-21 공동현관 출입번호는 frontdoorPassword 로 따로 접수(메모와 분리)
 *  OA-10 로그인·권한 확인
 *  OA-11 요청한 단계가 현재 단계의 다음 단계가 아니면 400(화면과 어긋난 요청)
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k', DHERO_API_BASE_URL: 'https://x', DHERO_TOKEN: 't', DHERO_SPOT_CODE: 's' } }))

// ── 테이블별 조회 모의 ──
interface Unit { id: number; status: string; pickup_method: string | null; return_method: string | null }
let orderId: number | null = 77
let units: Unit[] = []
const mockRpc = vi.fn()

function builder(table: string) {
  const st = { table, filters: [] as Array<[string, unknown]> }
  const resolve = (single: boolean) => {
    if (table === 'order_items') {
      if (single) return { data: orderId == null ? null : { order_id: orderId }, error: null }
      return { data: orderId == null ? [] : units.map((u) => ({ reservation_id: u.id })), error: null }
    }
    if (table === 'rental_reservations') {
      const inFilter = st.filters.find(([k]) => k === 'id')
      const ids = Array.isArray(inFilter?.[1]) ? (inFilter?.[1] as number[]) : units.map((u) => u.id)
      return { data: units.filter((u) => ids.includes(u.id)), error: null }
    }
    return { data: single ? null : [], error: null }
  }
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (k: string, v: unknown) => { st.filters.push([k, v]); return b }
  b.in = (k: string, v: unknown) => { st.filters.push([k, v]); return b }
  b.is = () => b
  b.order = () => b
  b.limit = () => b
  b.maybeSingle = async () => resolve(true)
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve(false)).then(res, rej)
  return b
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockRpc, from: (t: string) => builder(t) }) }))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockGetCmsRoleForAction(...a) }))

const mockCreateDelivery = vi.fn()
const mockCancelDelivery = vi.fn()
const mockRegisterReturn = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  createDelivery: (...a: unknown[]) => mockCreateDelivery(...a),
  cancelDelivery: (...a: unknown[]) => mockCancelDelivery(...a),
  registerReturn: (...a: unknown[]) => mockRegisterReturn(...a),
  DHERO_STATUS_LABEL: { 0: '배송접수' },
  DheroApiError: class DheroApiError extends Error { statusCode: number; constructor(m: string, s: number) { super(m); this.statusCode = s } },
  DheroNetworkError: class DheroNetworkError extends Error {},
}))

const mockGetReservationForDhero = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({ getReservationForDhero: (...a: unknown[]) => mockGetReservationForDhero(...a) }))

const mockIsDhero = vi.fn()
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({ isDheroIntegrationMethod: (...a: unknown[]) => mockIsDhero(...a) }))

const mockPush = vi.fn()
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: (...a: unknown[]) => mockPush(...a) }))
vi.mock('$lib/server/reservationApprovalNotify', () => ({ resolveApprovalNotifyPlan: vi.fn() }))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({ clearIssuedContractContent: vi.fn() }))
vi.mock('$lib/utils/cmsPermissions', () => ({ hasSettingsAccess: () => true }))

function form(values: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(values).forEach(([k, v]) => fd.append(k, v))
  return fd
}
function ev(values: Record<string, string>, authed = true) {
  return {
    request: { formData: async () => form(values) } as unknown as Request,
    locals: { safeGetSession: async () => ({ session: authed ? { user: { id: 'admin-uid' } } : null }), supabase: { rpc: vi.fn() } },
  }
}

const dheroRes = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  reservationId: id, status: 'confirmed', pickupMethod: 'delivery', returnMethod: 'delivery', trackingNumber: null, reservationCode: 'CS-ORD-77',
  dheroStatus: null, dheroStatusCode: null, dheroSyncedAt: null, dheroDongGroup: null, dheroReturnBookId: null, dheroMeta: null,
  customerName: '홍길동', customerPhone: '010-1234-5678', address: '서울시 강남구 테헤란로 1', addressDetail: '101호', postalCode: '06236', productName: name, notes: null, ...extra,
})

type Result = { ok?: boolean; status?: number; data?: Record<string, unknown>; processed?: number[]; failed?: Array<{ id: number; message: string }>; skipped?: number[]; dhero_book_failed?: string }
async function run(values: Record<string, string>, authed = true): Promise<Result> {
  const { actions } = await import('../../routes/cms/reservation/+page.server')
  const handler = (actions as unknown as Record<string, (e: unknown) => Promise<Result>>).updateOrderStatus
  expect(handler, 'updateOrderStatus 액션').toBeTypeOf('function')
  return handler(ev(values, authed))
}

const rpcCalls = (fn: string) => mockRpc.mock.calls.filter((c) => c[0] === fn)

beforeEach(() => {
  mockRpc.mockReset().mockImplementation(async () => ({ data: { ok: true }, error: null }))
  mockCreateDelivery.mockReset().mockResolvedValue({ bookId: 'BOOK-1', dongGroup: 'G1', placePageUrl: 'https://place.example/p1' })
  mockCancelDelivery.mockReset()
  mockRegisterReturn.mockReset().mockResolvedValue({ bookId: 'R-1', dongGroup: 'G1' })
  mockGetReservationForDhero.mockReset().mockImplementation(async (_a: unknown, id: number) => dheroRes(id, id === 1 ? 'Sony FX3' : 'Manfrotto 055'))
  mockIsDhero.mockReset().mockResolvedValue(true)
  mockPush.mockReset().mockResolvedValue(undefined)
  mockGetCmsRoleForAction.mockReset().mockResolvedValue('manager')
  orderId = 77
  units = [
    { id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' },
    { id: 2, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' },
  ]
})

describe('updateOrderStatus 액션 — 주문 단위 단일 처리', () => {
  it('OA-1: 상품 전부 전환 + 알림 주문당 1회 + 두발히어로 접수 주문당 1회(상품명 합쳐 한 건) + 접수번호 상품 전부에 저장', async () => {
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.ok).toBe(true)
    expect(r.processed).toEqual([1, 2])
    // 상태 전환은 상품마다
    expect(rpcCalls('update_reservation_status').map((c) => c[1].p_reservation_id)).toEqual([1, 2])
    // 고객 알림은 대표 예약 1건(채팅 1 + 푸시 1)
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'shipment_notify')).toHaveLength(1)
    expect(mockPush.mock.calls.filter((c) => c[2] === 'shipment_notify')).toHaveLength(1)
    // 두발히어로 접수 1회, 상품명 합침, 주문번호=예약코드
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    const arg = mockCreateDelivery.mock.calls[0][0] as { productName: string; orderIdFromCorp: string }
    expect(arg.productName).toContain('Sony FX3')
    expect(arg.productName).toContain('Manfrotto 055')
    expect(arg.orderIdFromCorp).toBe('CS-ORD-77')
    // 같은 접수번호를 형제 전부에 저장
    const saves = rpcCalls('update_reservation_dhero_shipment')
    expect(saves.map((c) => [c[1].p_reservation_id, c[1].p_tracking_number])).toEqual([[1, 'BOOK-1'], [2, 'BOOK-1']])
    // 수령 위치 안내 카드는 1회
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'dhero_place_guide')).toHaveLength(1)
  })

  it('OA-2: 상태가 섞이면 가장 덜 진행된 상품만 처리하고 나머지는 건너뜀으로 알린다', async () => {
    units = [
      { id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' },
      { id: 2, status: 'shipped', pickup_method: 'delivery', return_method: 'delivery' },
    ]
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1])
    expect(r.skipped).toEqual([2])
    expect(rpcCalls('update_reservation_status').map((c) => c[1].p_reservation_id)).toEqual([1])
  })

  it('OA-3: 일부 실패 — 성공한 상품은 유지, 실패한 상품을 알리고 알림·두발히어로는 성공 기준', async () => {
    mockRpc.mockImplementation(async (fn: string, args: { p_reservation_id?: number }) => {
      if (fn === 'update_reservation_status' && args.p_reservation_id === 2) return { data: { ok: false, error: '허용되지 않은 상태 전환입니다.' }, error: null }
      return { data: { ok: true }, error: null }
    })
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.ok).toBe(true)
    expect(r.processed).toEqual([1])
    expect(r.failed?.map((f) => f.id)).toEqual([2])
    expect(r.failed?.[0].message).toContain('허용되지 않은')
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'shipment_notify')).toHaveLength(1)
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => c[1].p_reservation_id)).toEqual([1])
  })

  it('OA-4: 전부 실패하면 오류이고 알림·두발히어로는 호출하지 않는다', async () => {
    mockRpc.mockImplementation(async (fn: string) => (fn === 'update_reservation_status' ? { data: { ok: false, error: '처리 실패' }, error: null } : { data: { ok: true }, error: null }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpcCalls('send_rental_chat_notification')).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('OA-5: 허용하지 않는 목표 단계는 400이고 아무것도 호출하지 않는다', async () => {
    for (const status of ['completed', 'cancelled', 'confirmed', 'damage_claimed', 'hold', '']) {
      const r = await run({ reservation_id: '1', status })
      expect(r.status, status).toBe(400)
      expect((r.data as { message?: string } | undefined)?.message, status).toContain('주문 일괄 처리로 변경할 수 없습니다')
    }
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('OA-6: 주문에 묶이지 않은 예약은 자기 자신만 처리', async () => {
    orderId = null
    units = [{ id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' }]
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1])
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
  })

  it('OA-7: 두발히어로 연동이 꺼져 있으면 접수 미호출, 알림은 1회', async () => {
    mockIsDhero.mockResolvedValue(false)
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.ok).toBe(true)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'shipment_notify')).toHaveLength(1)
  })

  it('OA-8: 접수 실패(API 오류)해도 상태 전환은 유지되고 dhero_book_failed 만 돌려준다', async () => {
    mockCreateDelivery.mockRejectedValue(new Error('boom'))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.ok).toBe(true)
    expect(r.processed).toEqual([1, 2])
    expect(typeof r.dhero_book_failed).toBe('string')
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
  })

  it('OA-9: 반납 접수 — 반품 접수는 주문당 1회, 반품번호를 상품 전부에 저장', async () => {
    units = [
      { id: 1, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' },
      { id: 2, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' },
    ]
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { status: 'in_use', trackingNumber: 'BOOK-1' }))
    const r = await run({ reservation_id: '1', status: 'return_requested' })
    expect(r.processed).toEqual([1, 2])
    expect(mockRegisterReturn).toHaveBeenCalledTimes(1)
    expect(mockRegisterReturn).toHaveBeenCalledWith('BOOK-1')
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => [c[1].p_reservation_id, c[1].p_return_book_id])).toEqual([[1, 'R-1'], [2, 'R-1']])
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'return_registration')).toHaveLength(1)
  })

  it('OA-12: 반납 접수 — 대표 예약에 운송장이 없어도 같은 주문 다른 상품의 접수번호로 반품 접수한다', async () => {
    units = [
      { id: 1, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' },
      { id: 2, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' },
    ]
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { status: 'in_use', trackingNumber: id === 2 ? 'BOOK-9' : null }))
    const r = await run({ reservation_id: '1', status: 'return_requested' })
    expect(r.processed).toEqual([1, 2])
    expect(mockRegisterReturn).toHaveBeenCalledTimes(1)
    expect(mockRegisterReturn).toHaveBeenCalledWith('BOOK-9')
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => [c[1].p_reservation_id, c[1].p_tracking_number])).toEqual([[1, 'BOOK-9'], [2, 'BOOK-9']])
  })

  it('OA-13: 접수 상품명 — 같은 상품은 ×수량으로 합치고 500자를 넘기지 않는다', async () => {
    units = [1, 2, 3].map((id) => ({ id, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' }))
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, id === 3 ? 'Manfrotto 055' : 'Sony FX3'))
    await run({ reservation_id: '1', status: 'shipped' })
    expect((mockCreateDelivery.mock.calls[0][0] as { productName: string }).productName).toBe('Sony FX3 ×2 + Manfrotto 055')

    mockCreateDelivery.mockClear()
    const long = '가'.repeat(300)
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `${long}${id}`))
    await run({ reservation_id: '1', status: 'shipped' })
    expect((mockCreateDelivery.mock.calls[0][0] as { productName: string }).productName.length).toBeLessThanOrEqual(500)
  })

  it('OA-14: 주문의 어느 상품에든 접수번호가 이미 있으면(수동 접수 등) 출고 처리가 다시 접수하지 않는다', async () => {
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: id === 2 ? 'BOOK-OLD' : null, courierCode: id === 2 ? '두발히어로' : null }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1, 2])
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
    expect(rpcCalls('send_rental_chat_notification').filter((c) => c[1].p_notify_type === 'shipment_notify')).toHaveLength(1)
  })

  it('OA-15: 대표 예약 자신에게 접수번호가 있으면(단건 주문 포함) 출고 처리가 다시 접수하지 않는다', async () => {
    orderId = null
    units = [{ id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' }]
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: 'BOOK-X', courierCode: '두발히어로' }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1])
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
  })

  it('OA-16: 두발히어로 접수번호로 건너뛸 때는 안내가 없고, 다른 택배사 운송장이면 건너뛰되 관리자에게 안내한다', async () => {
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: id === 2 ? 'BOOK-OLD' : null, courierCode: id === 2 ? '두발히어로' : null }))
    const quiet = await run({ reservation_id: '1', status: 'shipped' })
    expect(quiet.dhero_book_failed).toBeUndefined()
    expect(mockCreateDelivery).not.toHaveBeenCalled()

    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: id === 1 ? '1234567890' : null, courierCode: id === 1 ? 'CJ대한통운' : null }))
    const warned = await run({ reservation_id: '1', status: 'shipped' })
    expect(warned.ok).toBe(true)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(warned.dhero_book_failed).toContain('CJ대한통운')
    expect(warned.dhero_book_failed).toContain('건너뛰었습니다')
  })

  it('OA-17: 반품 접수가 success=false 로 거절되면 반품번호를 저장하지 않고 관리자에게 알린다(이슈 #9)', async () => {
    units = [{ id: 1, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' }]
    orderId = null
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { status: 'in_use', trackingNumber: 'BOOK-1', courierCode: '두발히어로' }))
    mockRegisterReturn.mockResolvedValue({ bookId: 'R-1', success: false, reason: '수거지 설정 오류' })
    const r = await run({ reservation_id: '1', status: 'return_requested' })
    expect(r.ok).toBe(true)
    expect(r.processed).toEqual([1])
    expect(rpcCalls('update_reservation_dhero_shipment')).toHaveLength(0)
    expect(r.dhero_book_failed).toContain('수거지 설정 오류')
  })

  it('OA-18: 반품 접수가 예외로 실패해도 상태 전환은 유지되고 관리자에게 알린다', async () => {
    units = [{ id: 1, status: 'in_use', pickup_method: 'delivery', return_method: 'delivery' }]
    orderId = null
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { status: 'in_use', trackingNumber: 'BOOK-1', courierCode: '두발히어로' }))
    mockRegisterReturn.mockRejectedValue(new Error('boom'))
    const r = await run({ reservation_id: '1', status: 'return_requested' })
    expect(r.processed).toEqual([1])
    expect(r.dhero_book_failed).toContain('반품 접수에 실패')
  })

  it('OA-19: 배송 접수 메모는 새 수령용 요청사항(pickupRequestNote)을 싣는다(③)', async () => {
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { pickupRequestNote: '공동현관 1234*', notes: null }))
    await run({ reservation_id: '1', status: 'shipped' })
    expect((mockCreateDelivery.mock.calls[0][0] as { memoFromCustomer?: string }).memoFromCustomer).toBe('공동현관 1234*')
  })

  it('OA-20: 두발히어로 쪽에서 이미 취소된 접수번호는 \'접수됨\'으로 보지 않고 새로 접수한다(취소 정보는 dhero_meta.canceledAt)', async () => {
    orderId = null
    units = [{ id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' }]
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: 'BOOK-CANCELED', courierCode: '두발히어로', dheroMeta: { canceledAt: '2026-10-27 15:34:52' } }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1])
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    expect(r.dhero_book_failed).toBeUndefined()
    expect(rpcCalls('update_reservation_dhero_shipment').map((c) => c[1].p_tracking_number)).toEqual(['BOOK-1'])
  })

  it('OA-21: 공동현관 출입번호(frontdoorPassword)는 메모와 별도 칸으로 접수에 실린다 — 운송장에 인쇄되는 메모에 섞이지 않는다', async () => {
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { pickupRequestNote: '경비실 호출', frontdoorPassword: '#0418*' }))
    await run({ reservation_id: '1', status: 'shipped' })
    const arg = mockCreateDelivery.mock.calls[0][0] as { memoFromCustomer?: string; frontdoorPassword?: string }
    expect(arg.frontdoorPassword).toBe('#0418*')
    expect(arg.memoFromCustomer).toBe('경비실 호출')
  })

  it('OA-22: 다상품 주문에서 한쪽 상품만 취소를 알아도 같은 접수번호 전체를 취소로 보고 재접수한다(형제 meta 지연)', async () => {
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: 'BOOK-OLD', courierCode: '두발히어로', dheroMeta: id === 1 ? { canceledAt: '2026-10-27 15:34:52' } : { canceledAt: null } }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(r.processed).toEqual([1, 2])
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    expect(r.dhero_book_failed).toBeUndefined()
  })

  it('OA-23: 다른 택배사 운송장이면 canceledAt 이 있어도 재접수하지 않고 안내한다(courier 조건)', async () => {
    orderId = null
    units = [{ id: 1, status: 'confirmed', pickup_method: 'delivery', return_method: 'delivery' }]
    mockGetReservationForDhero.mockImplementation(async (_a: unknown, id: number) => dheroRes(id, `P${id}`, { trackingNumber: '1234567890', courierCode: 'CJ대한통운', dheroMeta: { canceledAt: '2026-10-27 15:34:52' } }))
    const r = await run({ reservation_id: '1', status: 'shipped' })
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.dhero_book_failed).toContain('CJ대한통운')
  })

  it('OA-10: 로그인·권한이 없으면 거절한다', async () => {
    expect((await run({ reservation_id: '1', status: 'shipped' }, false)).status).toBe(401)
    mockGetCmsRoleForAction.mockResolvedValue(null)
    expect((await run({ reservation_id: '1', status: 'shipped' })).status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('OA-11: 요청 단계가 현재 단계의 다음 단계가 아니면 400', async () => {
    const r = await run({ reservation_id: '1', status: 'in_use' }) // confirmed 상태에서 in_use 요청(배송 수령은 shipped 경유)
    expect(r.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
