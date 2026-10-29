import { describe, it, expect, vi, beforeEach } from 'vitest'
/**
 * 두발히어로 GET 라우트 — 반납 leg 표시 보완 (sp3 4차 경미 1~3)
 *  - 경미 1: 반납 조회는 fetchReturnLegForDisplay(8초 상한·실패 무시)를 거친다
 *  - 경미 2: 반출 조회가 실패해도 반납 조회는 수행되어 응답에 returnDhero 가 실린다
 *  - 경미 3: returnDhero 에는 패널이 쓰는 필드만 담고 기사 정보 등은 내려주지 않는다
 */

vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: vi.fn(async () => null),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data },
  }),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}))

const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: vi.fn() }),
}))

const mockGetDeliveryByBookId = vi.fn()
const { MockDheroApiError } = vi.hoisted(() => ({
  MockDheroApiError: class extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))
vi.mock('$lib/server/dhero', () => ({
  getDeliveryByBookId: (...args: unknown[]) => mockGetDeliveryByBookId(...args),
  createDelivery: vi.fn(),
  DheroApiError: MockDheroApiError,
  DHERO_STATUS_LABEL: { 0: '배송접수' },
}))

const mockFetchReturnLeg = vi.fn()
vi.mock('$lib/server/dheroReturnLegDisplay', () => ({
  fetchReturnLegForDisplay: (...args: unknown[]) => mockFetchReturnLeg(...args),
}))

const mockGetReservationForDhero = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservationForDhero(...args),
}))
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({
  isDheroIntegrationMethod: vi.fn().mockResolvedValue(true),
}))
vi.mock('$lib/server/dheroAutoAdvance', () => ({
  maybeAutoAdvanceOnDheroDelivered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/utils/dheroLabels', () => ({
  dheroStatusLabel: vi.fn().mockReturnValue('배송접수'),
  liveDheroBookings: vi.fn().mockReturnValue([]),
}))
vi.mock('$lib/server/notifyTrackingRegistered', () => ({
  notifyTrackingRegistered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/server/dheroMemo', () => ({ pickDeliveryMemo: vi.fn().mockReturnValue('') }))
vi.mock('$lib/server/dheroOrderUnits', () => ({
  listOrderReservationIds: vi.fn().mockResolvedValue([]),
  joinProductNames: vi.fn().mockReturnValue(''),
  isDheroBooking: vi.fn().mockReturnValue(true),
}))

import { GET } from '../../routes/api/cms/reservations/[id]/dhero/+server'

const OUTBOUND = { bookId: 'B-1', status: 4 }
const RETURN_FULL = {
  bookId: 'RB-1',
  status: 2,
  statusText: '수거완료',
  canceledAt: null,
  accidentAt: null,
  deliveryRiderName: '김기사',
  deliveryRiderMobile: '01099998888',
  placePageUrl: 'https://example.test/place',
  receiverMobile: '01012345678',
}

function makeRes(returnBookId: string | null) {
  return {
    trackingNumber: 'B-1',
    courierCode: '두발히어로',
    pickupMethod: 'crazydelivery',
    returnMethod: 'crazydelivery',
    status: 'return_requested',
    dheroDongGroup: null,
    dheroReturnBookId: returnBookId,
    frontdoorPassword: 'secret',
  }
}

async function callGet() {
  const res = await GET({ params: { id: '7' }, locals: {} } as never)
  return res.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRpc.mockResolvedValue({ data: null, error: null })
})

describe('GET dhero — 반납 leg 표시 보완', () => {
  it('경미1: 반납 조회는 fetchReturnLegForDisplay 를 거치고, 라우트가 직접 반납번호로 조회하지 않는다', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes('RB-1'))
    mockGetDeliveryByBookId.mockResolvedValue(OUTBOUND)
    mockFetchReturnLeg.mockResolvedValue(RETURN_FULL)

    await callGet()

    expect(mockFetchReturnLeg).toHaveBeenCalledTimes(1)
    expect(mockFetchReturnLeg.mock.calls[0][0]).toBe('RB-1')
    expect(mockGetDeliveryByBookId).toHaveBeenCalledTimes(1)
    expect(mockGetDeliveryByBookId).toHaveBeenCalledWith('B-1')
  })

  it('경미2: 반출 조회가 실패해도 반납 조회가 수행되어 returnDhero 가 응답에 실린다', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes('RB-1'))
    mockGetDeliveryByBookId.mockRejectedValue(new MockDheroApiError('timeout', 504))
    mockFetchReturnLeg.mockResolvedValue(RETURN_FULL)

    const body = await callGet()

    expect(body.dhero).toBeNull()
    expect(body.dhero_error).toBeTruthy()
    expect((body.returnDhero as { bookId: string }).bookId).toBe('RB-1')
  })

  it('경미2: 반납번호가 없으면 반납 조회를 하지 않고 returnDhero 는 null', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes(null))
    mockGetDeliveryByBookId.mockResolvedValue(OUTBOUND)

    const body = await callGet()

    expect(mockFetchReturnLeg).not.toHaveBeenCalled()
    expect(body.returnDhero).toBeNull()
  })

  it('경미2: 반납 조회가 null(실패·시간초과)이면 returnDhero null, 반출 결과는 그대로', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes('RB-1'))
    mockGetDeliveryByBookId.mockResolvedValue(OUTBOUND)
    mockFetchReturnLeg.mockResolvedValue(null)

    const body = await callGet()

    expect(body.returnDhero).toBeNull()
    expect((body.dhero as { bookId: string }).bookId).toBe('B-1')
  })

  it('경미3: returnDhero 에는 패널이 쓰는 필드만 담고 기사 연락처 등은 내려주지 않는다', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes('RB-1'))
    mockGetDeliveryByBookId.mockResolvedValue(OUTBOUND)
    mockFetchReturnLeg.mockResolvedValue(RETURN_FULL)

    const body = await callGet()
    const ret = body.returnDhero as Record<string, unknown>

    expect(ret.bookId).toBe('RB-1')
    expect(ret.status).toBe(2)
    expect(ret).not.toHaveProperty('deliveryRiderName')
    expect(ret).not.toHaveProperty('deliveryRiderMobile')
    expect(ret).not.toHaveProperty('receiverMobile')
    expect(ret).not.toHaveProperty('placePageUrl')
  })

  it('반납 조회 성공 시 반납 상태가 저장된다(기존 동작 유지)', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeRes('RB-1'))
    mockGetDeliveryByBookId.mockResolvedValue(OUTBOUND)
    mockFetchReturnLeg.mockResolvedValue(RETURN_FULL)

    await callGet()

    const returnSave = mockRpc.mock.calls.find((c) => (c[1] as { p_return_book_id: string | null }).p_return_book_id === 'RB-1')
    expect(returnSave).toBeTruthy()
    expect((returnSave![1] as { p_status_code: number }).p_status_code).toBe(2)
  })
})
