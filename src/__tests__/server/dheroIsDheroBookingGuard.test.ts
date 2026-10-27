import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
/**
 * TDD RED — P3 항목 2: isDheroBooking 헬퍼 + 배송취소 라우트 courier_code 가드
 *
 * 완료조건:
 *   - isDheroBooking(null|undefined|'두발히어로') → true (dhero API 호출)
 *   - isDheroBooking(그 외) → false (skip)
 *   - PUT dhero/cancel: courier_code != DHero → ok:true, dhero_skipped:true, cancelDelivery 미호출
 */

vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: vi.fn(async () => null),
  requireAnyMenuAccessApi: vi.fn(async () => null),
  requireMenuAccessAction: vi.fn(async () => true),
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
const mockFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: mockFrom }),
}))

const mockCancelDelivery = vi.fn()
const mockGetDeliveryByBookId = vi.fn()
class MockDheroApiError extends Error {
  statusCode: number
  constructor(msg: string, code: number) { super(msg); this.statusCode = code }
}
vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: (...args: unknown[]) => mockCancelDelivery(...args),
  getDeliveryByBookId: (...args: unknown[]) => mockGetDeliveryByBookId(...args),
  DheroApiError: MockDheroApiError,
  DHERO_STATUS_LABEL: { 0: '배송접수' },
  createDelivery: vi.fn().mockResolvedValue({ bookId: 'NEW-BOOK', dongGroup: null }),
}))

// dhero GET route 추가 의존성
const mockGetReservationForDhero = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservationForDhero(...args),
}))

const mockIsDheroIntegrationMethod = vi.fn()
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({
  isDheroIntegrationMethod: (...args: unknown[]) => mockIsDheroIntegrationMethod(...args),
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

vi.mock('$lib/server/dheroMemo', () => ({
  pickDeliveryMemo: vi.fn().mockReturnValue(''),
}))

// payment + cancelReservationWithRefund 추가 의존성
const mockFindOrderPaymentTransaction = vi.fn()
vi.mock('$lib/server/findOrderPaymentTransaction', () => ({
  findOrderPaymentTransaction: (...args: unknown[]) => mockFindOrderPaymentTransaction(...args),
}))

const mockRpcRetryWithFailSoftLog = vi.fn()
vi.mock('$lib/server/rpcRetryWithFailSoftLog', () => ({
  rpcRetryWithFailSoftLog: (...args: unknown[]) => mockRpcRetryWithFailSoftLog(...args),
}))

vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
  sendPushToAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('$env/dynamic/private', () => ({
  env: {
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    TOSS_SECRET_KEY: 'test-toss-key',
    CRON_SECRET: 'cron-secret',
  },
}))

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}))

function makeLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) }
}

/** 최소 DheroReservationInfo 객체 생성 헬퍼 */
function makeFakeRes(trackingNumber: string | null, courierCode: string | null | undefined) {
  return {
    trackingNumber,
    courierCode: courierCode ?? null,
    pickupMethod: 'crazydelivery',
    returnMethod: 'crazydelivery',
    status: 'shipped',
    reservationCode: 'CS-TEST-001',
    customerName: '홍길동',
    customerPhone: '01012345678',
    address: '서울 강남구 테헤란로 1',
    addressDetail: '101호',
    postalCode: '06236',
    productName: '카메라A',
    dheroDongGroup: null,
    dheroReturnBookId: null,
    frontdoorPassword: null,
  }
}

function setupFrom(trackingNumber: string | null, courierCode?: string | null) {
  const row: Record<string, unknown> = { tracking_number: trackingNumber }
  if (courierCode !== undefined) row.courier_code = courierCode
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  })
}

// ── isDheroBooking 순수 단위 테스트 ─────────────────────────────────────────

describe('isDheroBooking 헬퍼', () => {
  it('null → true (하위호환 — courier_code 컬럼 도입 전 예약)', async () => {
    const { isDheroBooking } = await import('$lib/server/dheroOrderUnits')
    expect(isDheroBooking(null)).toBe(true)
  })
  it('undefined → true (하위호환)', async () => {
    const { isDheroBooking } = await import('$lib/server/dheroOrderUnits')
    expect(isDheroBooking(undefined)).toBe(true)
  })
  it('"두발히어로" → true', async () => {
    const { isDheroBooking } = await import('$lib/server/dheroOrderUnits')
    expect(isDheroBooking('두발히어로')).toBe(true)
  })
  it('"CJ대한통운" → false', async () => {
    const { isDheroBooking } = await import('$lib/server/dheroOrderUnits')
    expect(isDheroBooking('CJ대한통운')).toBe(false)
  })
  it('"우체국택배" → false', async () => {
    const { isDheroBooking } = await import('$lib/server/dheroOrderUnits')
    expect(isDheroBooking('우체국택배')).toBe(false)
  })
})

// ── PUT dhero/cancel — courier_code 가드 ─────────────────────────────────────

describe('PUT /api/cms/reservations/[id]/dhero/cancel — courier_code 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: null, error: null })
  })

  it('courier_code = "두발히어로" → cancelDelivery 호출', async () => {
    setupFrom('BOOK-1', '두발히어로')
    mockCancelDelivery.mockResolvedValue(undefined)
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    const res = await PUT({ params: { id: '1' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; dhero_skipped?: boolean }
    expect(body.ok).toBe(true)
    expect(body.dhero_skipped).toBeUndefined()
    expect(mockCancelDelivery).toHaveBeenCalledWith('BOOK-1')
  })

  it('courier_code = null → cancelDelivery 호출 (하위호환)', async () => {
    setupFrom('BOOK-2', null)
    mockCancelDelivery.mockResolvedValue(undefined)
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    const res = await PUT({ params: { id: '2' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockCancelDelivery).toHaveBeenCalledWith('BOOK-2')
  })

  it('courier_code = "CJ대한통운" → cancelDelivery 건너뜀, { ok: true, dhero_skipped: true }', async () => {
    setupFrom('CJ-1234567890', 'CJ대한통운')
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    const res = await PUT({ params: { id: '3' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; dhero_skipped?: boolean }
    expect(body.ok).toBe(true)
    expect(body.dhero_skipped).toBe(true)
    expect(mockCancelDelivery).not.toHaveBeenCalled()
  })

  it('courier_code 필드 없음(구형 조회) → cancelDelivery 호출 (하위호환)', async () => {
    // courier_code 컬럼 자체가 없는 구형 응답 — undefined 처리 확인
    setupFrom('BOOK-OLD')  // courierCode 인자 생략 = row에 courier_code 키 없음
    mockCancelDelivery.mockResolvedValue(undefined)
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server')
    const res = await PUT({ params: { id: '4' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockCancelDelivery).toHaveBeenCalledWith('BOOK-OLD')
  })
})

// ── GET /api/cms/reservations/[id]/dhero — courier_code 가드 ─────────────────

describe('GET /api/cms/reservations/[id]/dhero — courier_code 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: null, error: null })
    mockIsDheroIntegrationMethod.mockResolvedValue(false)
  })

  it('trackingNumber 있고 courierCode = "CJ대한통운" → getDeliveryByBookId 미호출 (타 택배사 방어)', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeFakeRes('CJ-9876543210', 'CJ대한통운'))
    const { GET } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    const body = await res.json() as { dhero: unknown }
    expect(body.dhero).toBeNull()
    expect(mockGetDeliveryByBookId).not.toHaveBeenCalled()
  })

  it('trackingNumber 없음 → getDeliveryByBookId 미호출', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeFakeRes(null, '두발히어로'))
    const { GET } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = await GET({ params: { id: '11' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockGetDeliveryByBookId).not.toHaveBeenCalled()
  })

  it('trackingNumber 있고 courierCode = null → getDeliveryByBookId 호출 (하위호환)', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeFakeRes('DHERO-100', null))
    mockGetDeliveryByBookId.mockResolvedValue({ status: 1, bookId: 'DHERO-100' })
    const { GET } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = await GET({ params: { id: '12' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockGetDeliveryByBookId).toHaveBeenCalledWith('DHERO-100')
  })

  it('trackingNumber 있고 courierCode = "두발히어로" → getDeliveryByBookId 호출', async () => {
    mockGetReservationForDhero.mockResolvedValue(makeFakeRes('DHERO-200', '두발히어로'))
    mockGetDeliveryByBookId.mockResolvedValue({ status: 2, bookId: 'DHERO-200' })
    const { GET } = await import('../../routes/api/cms/reservations/[id]/dhero/+server')
    const res = await GET({ params: { id: '13' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockGetDeliveryByBookId).toHaveBeenCalledWith('DHERO-200')
  })
})

// ── PUT /api/cms/reservations/[id]/payment — cancelDelivery 가드 ─────────────

/** 단순 체인 빌더 — maybeSingle 전용 */
function makeOneChain(result: { data: unknown; error: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {}
  c.select = vi.fn().mockReturnValue(c)
  c.eq = vi.fn().mockReturnValue(c)
  c.order = vi.fn().mockReturnValue(c)
  c.limit = vi.fn().mockReturnValue(c)
  c.update = vi.fn().mockReturnValue(c)
  c.insert = vi.fn().mockReturnValue(c)
  c.in = vi.fn().mockReturnValue(c)
  c.maybeSingle = vi.fn().mockResolvedValue(result)
  c.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)))
  return c
}

describe('PUT /api/cms/reservations/[id]/payment — cancelDelivery 가드', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'CANCELED' }),
    } as Response)
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'cancel_reservation_payment') return Promise.resolve({
        data: { success: true, cancelled_reservation_ids: [20] }, error: null,
      })
      return Promise.resolve({ data: null, error: null })
    })
    // findOrderPaymentTransaction: payment_key + done
    mockFindOrderPaymentTransaction.mockResolvedValue({
      data: { payment_key: 'pk_test_pay', status: 'done' }, error: null,
    })
    // rpcRetryWithFailSoftLog: delegate to mockRpc result
    mockRpcRetryWithFailSoftLog.mockResolvedValue({
      rpcResult: { success: true, cancelled_reservation_ids: [20] },
      failed: false,
      failureReason: null,
    })
  })

  afterEach(() => { fetchSpy.mockRestore() })

  it('courier_code = "CJ대한통운" → cancelDelivery 미호출 (타 택배사 방어)', async () => {
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        // rental_reservations status check (double-guard)
        return makeOneChain({ data: { status: 'confirmed' }, error: null })
      }
      // rental_reservations tracking/courier (guard in loop for cancelledId=20)
      return makeOneChain({ data: { tracking_number: 'CJ-9999999', courier_code: 'CJ대한통운' }, error: null })
    })
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/payment/+server')
    const req = new Request('http://localhost', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: '테스트 취소' }),
    })
    const res = await PUT({ params: { id: '20' }, locals: makeLocals(), request: req, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockCancelDelivery).not.toHaveBeenCalled()
  })

  it('courier_code = null → cancelDelivery 호출 (하위호환)', async () => {
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return makeOneChain({ data: { status: 'confirmed' }, error: null })
      }
      return makeOneChain({ data: { tracking_number: 'DHERO-777', courier_code: null }, error: null })
    })
    mockCancelDelivery.mockResolvedValue(undefined)
    const { PUT } = await import('../../routes/api/cms/reservations/[id]/payment/+server')
    const req = new Request('http://localhost', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: '테스트 취소' }),
    })
    const res = await PUT({ params: { id: '21' }, locals: makeLocals(), request: req, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    expect(mockCancelDelivery).toHaveBeenCalledWith('DHERO-777')
  })
})

// ── cancelReservationWithRefund — isDheroBooking 가드 ────────────────────────

describe('cancelReservationWithRefund — isDheroBooking 가드', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'CANCELED' }),
    } as Response)
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'cancel_reservation_payment') return Promise.resolve({
        data: { success: true, cancelled_reservation_ids: [30] }, error: null,
      })
      return Promise.resolve({ data: null, error: null })
    })
  })

  afterEach(() => { fetchSpy.mockRestore() })

  it('courier_code = "CJ대한통운" → cancelDelivery 미호출', async () => {
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        // payment_transactions direct lookup
        return makeOneChain({ data: { payment_key: 'pk_crf_test', status: 'done' }, error: null })
      }
      if (fromCallCount === 2) {
        // rental_reservations status double-guard
        return makeOneChain({ data: { status: 'confirmed' }, error: null })
      }
      // rental_reservations tracking/courier guard (cancelledId=30)
      return makeOneChain({ data: { tracking_number: 'CJ-55555', courier_code: 'CJ대한통운' }, error: null })
    })
    const { cancelReservationWithRefund } = await import('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({ reservationId: 30, callerId: 'user-1', cancelReason: '고객 취소' })
    expect(result.ok).toBe(true)
    expect(mockCancelDelivery).not.toHaveBeenCalled()
  })

  it('courier_code = null → cancelDelivery 호출 (하위호환)', async () => {
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return makeOneChain({ data: { payment_key: 'pk_crf_dhero', status: 'done' }, error: null })
      }
      if (fromCallCount === 2) {
        return makeOneChain({ data: { status: 'confirmed' }, error: null })
      }
      return makeOneChain({ data: { tracking_number: 'DHERO-888', courier_code: null }, error: null })
    })
    mockCancelDelivery.mockResolvedValue(undefined)
    const { cancelReservationWithRefund } = await import('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({ reservationId: 31, callerId: 'user-1', cancelReason: '고객 취소' })
    expect(result.ok).toBe(true)
    expect(mockCancelDelivery).toHaveBeenCalledWith('DHERO-888')
  })
})

// NOTE: cms/reservation updateStatus cancelled → triggerDheroForTransition 가드 테스트는
// dheroUpdateStatusTrigger.test.ts의 "P3-2 courier_code 가드" describe에 있습니다.
// (page.server.ts는 해당 파일의 완전한 mock 환경이 필요하므로 그 파일에서 테스트합니다)
