import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD — updateStatus 액션 내 두발히어로 자동호출 트리거 (fail-soft) 검증
 *
 * 대상: src/routes/cms/reservation/+page.server.ts의 updateStatus 액션
 *
 * 케이스:
 *   1. shipped 전이 + pickup_method가 bulk_delivery → createDelivery 자동호출
 *      API 실패 시에도 상태전이 자체는 항상 성공 (fail-soft)
 *   2. in_use→return_requested 전이 + return_method가 bulk_delivery → registerReturn 자동호출
 *      API 실패 시에도 상태전이 성공 (fail-soft)
 *   3. cancelled 전이 + tracking_number 존재 + 취소가능 상태 → cancelDelivery 자동호출
 *      EC-1 (취소가능) / EC-2 (취소불가 412) 양쪽 모두 예약취소 자체는 성공
 *
 * EC-4: print:'r' 파라미터 확인 — 중복 orderIdFromCorp로 createDelivery 재호출 시
 *        기존 bookId를 그대로 반환해야 함(두발히어로 서버 처리, 클라이언트는 bookId만 저장)
 *
 * CRITICAL-1 수정 (2026-08-25):
 *   기존 테스트는 .select() 체인 전체를 mock으로 처리해 실제 PostgREST 스키마 오류를
 *   재현하지 못했음. 수정 후 getReservationForDhero($lib/server/getReservationForDhero)
 *   공유 모듈을 mock해 올바른 camelCase 필드명(customerName/address/postalCode 등)으로
 *   반환하도록 변경 — updateStatus 로직이 이 필드를 정확히 전달하는지 검증 가능.
 *   공유 모듈 자체의 SQL 정합성(실제 컬럼명 사용)은 해당 모듈 소스에서 직접 보장됨
 *   (rental_reservations에 존재하지 않는 컬럼 select 코드가 제거된 것을 확인 필수).
 */

// ── 모킹 ───────────────────────────────────────────────────────────────────

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
}))

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}))
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))
vi.mock('$env/dynamic/private', () => ({
  env: {
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    DHERO_API_BASE_URL: 'https://partner-api.dev.dhero.kr',
    DHERO_TOKEN: 'test-dhero-token',
    DHERO_SPOT_CODE: 'TEST-SPOT',
  },
}))

// Supabase createClient 모킹 — update_reservation_status, update_reservation_dhero_shipment 제어
// (getReservationForDhero는 별도 모듈로 mock하므로 from().select()...은 RPC 전용으로만 사용됨)
const mockRpc = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}))

// getCmsRoleForAction 모킹
const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

// dhero.ts 모킹
const mockCreateDelivery = vi.fn()
const mockCancelDelivery = vi.fn()
const mockRegisterReturn = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  createDelivery: (...args: unknown[]) => mockCreateDelivery(...args),
  cancelDelivery: (...args: unknown[]) => mockCancelDelivery(...args),
  registerReturn: (...args: unknown[]) => mockRegisterReturn(...args),
  DHERO_STATUS_LABEL: { 0: '배송접수', 1: '수거배차', 2: '수거완료', 3: '입고완료', 4: '출고완료', 5: '배송완료', 6: '반송완료', 7: '분실완료', 8: '배송대기', 12: '배송연기' },
  DheroApiError: class DheroApiError extends Error {
    statusCode: number
    constructor(msg: string, statusCode: number) { super(msg); this.statusCode = statusCode }
  },
  DheroNetworkError: class DheroNetworkError extends Error {},
}))

// getReservationForDhero 모킹 — CRITICAL-1 수정의 핵심
// updateStatus가 올바른 camelCase 필드(customerName/address 등)로 dhero 함수를 호출하는지 검증
const mockGetReservationForDhero = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservationForDhero(...args),
}))

// isBulkDeliveryMethod 모킹
const mockIsBulkDelivery = vi.fn()
vi.mock('$lib/server/isBulkDeliveryMethod', () => ({
  isBulkDeliveryMethod: (...args: unknown[]) => mockIsBulkDelivery(...args),
}))

// push, notification 모킹
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/server/reservationApprovalNotify', () => ({
  resolveApprovalNotifyPlan: vi.fn(),
}))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({
  clearIssuedContractContent: vi.fn(),
}))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: () => true,
}))

// ── 헬퍼 ───────────────────────────────────────────────────────────────────

function makeFormData(values: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(values).forEach(([k, v]) => fd.append(k, v))
  return fd
}

function makeLocals(authed = true, role = 'manager') {
  return {
    safeGetSession: async () => ({
      session: authed ? { user: { id: 'admin-uid' } } : null,
    }),
    supabase: { rpc: vi.fn() },
  }
}

// ── 테스트 ──────────────────────────────────────────────────────────────────

describe('updateStatus 액션 — dhero fail-soft 트리거', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockCreateDelivery.mockReset()
    mockCancelDelivery.mockReset()
    mockRegisterReturn.mockReset()
    mockIsBulkDelivery.mockReset()
    mockGetReservationForDhero.mockReset()
    mockGetCmsRoleForAction.mockResolvedValue('manager')
  })

  it('케이스 1 — shipped 전이 + bulk delivery → createDelivery 호출, 성공', async () => {
    // GREEN 상태: updateStatus 액션이 shipped 전이 시 isBulkDeliveryMethod 조회 후 createDelivery 호출

    // update_reservation_status 성공
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      if (fn === 'update_reservation_dhero_shipment') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    // 예약 조회 — getReservationForDhero mock (CRITICAL-1 수정: 올바른 camelCase 필드명)
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1001,
      status: 'confirmed',
      pickupMethod: 'crazydelivery',
      returnMethod: 'crazydelivery',
      trackingNumber: null,
      reservationCode: 'CS-2026-TEST',
      dheroStatus: null,
      dheroStatusCode: null,
      dheroSyncedAt: null,
      dheroDongGroup: null,
      dheroReturnBookId: null,
      dheroMeta: null,
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      address: '서울시 강남구 테헤란로 1',
      addressDetail: '101호',
      postalCode: '06236',
      productName: 'Sony FX3',
    })

    // pickup_method 'crazydelivery' = bulk delivery
    mockIsBulkDelivery.mockImplementation((_admin: unknown, key: string) =>
      Promise.resolve(key === 'crazydelivery')
    )

    // createDelivery 성공 → bookId 반환
    mockCreateDelivery.mockResolvedValue({
      bookId: 'DHERO-BOOK-001',
      dongGroup: 'GRP-A',
      addressNotSupported: false,
    })

    // FormData
    const formData = makeFormData({
      reservation_id: '1001',
      status: 'shipped',
    })

    // 액션 import 후 호출 (동적 import로 모킹이 적용된 상태에서 로드)
    const { actions } = await import('../../routes/cms/reservation/+page.server')

    const result = await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    // 상태전이는 항상 성공
    expect((result as { ok: boolean } | undefined)?.ok ?? (result as { data?: { ok: boolean } })?.data?.ok).toBeTruthy()
    // createDelivery 호출 확인
    expect(mockCreateDelivery).toHaveBeenCalledWith(expect.objectContaining({
      orderIdFromCorp: expect.any(String),
      productName: expect.any(String),
    }))
  })

  it('케이스 1 (fail-soft) — createDelivery API 실패 시에도 상태전이 자체는 성공', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1002,
      status: 'confirmed',
      pickupMethod: 'delivery',
      returnMethod: 'delivery',
      trackingNumber: null,
      reservationCode: 'CS-2026-FAIL',
      dheroStatus: null, dheroStatusCode: null, dheroSyncedAt: null,
      dheroDongGroup: null, dheroReturnBookId: null, dheroMeta: null,
      customerName: '김철수',
      customerPhone: '010-9999-9999',
      address: '서울시 종로구 종로 1',
      addressDetail: null,
      postalCode: '03154',
      productName: 'Sony A7IV',
    })
    mockIsBulkDelivery.mockResolvedValue(true)
    // createDelivery가 네트워크 오류로 throw
    mockCreateDelivery.mockRejectedValue(new Error('Network timeout'))

    const formData = makeFormData({
      reservation_id: '1002',
      status: 'shipped',
    })

    const { actions } = await import('../../routes/cms/reservation/+page.server')
    const result = await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    // fail-soft: 상태전이 성공 + dhero 실패는 경고만
    expect(result).not.toHaveProperty('status', 500)
    // update_reservation_status는 항상 호출됨
    expect(mockRpc).toHaveBeenCalledWith('update_reservation_status', expect.objectContaining({ p_new_status: 'shipped' }))
  })

  it('케이스 2 — return_requested 전이 + bulk delivery → registerReturn 호출', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      if (fn === 'update_reservation_dhero_shipment') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1003,
      status: 'in_use',
      pickupMethod: 'crazydelivery',
      returnMethod: 'crazydelivery',
      trackingNumber: 'DHERO-BOOK-002', // 이미 배송접수된 건
      reservationCode: 'CS-2026-RETURN',
      dheroStatus: '출고완료', dheroStatusCode: 4, dheroSyncedAt: null,
      dheroDongGroup: 'GRP-B', dheroReturnBookId: null, dheroMeta: null,
      customerName: '이영희',
      customerPhone: '010-8888-7777',
      address: '부산시 해운대구 센텀시티로 1',
      addressDetail: '202호',
      postalCode: '48060',
      productName: 'Canon R5',
    })
    // return_method가 bulk delivery
    mockIsBulkDelivery.mockImplementation((_admin: unknown, key: string) =>
      Promise.resolve(key === 'crazydelivery')
    )
    mockRegisterReturn.mockResolvedValue({
      bookId: 'DHERO-RETURN-001R',
      dongGroup: 'GRP-B',
      addressNotSupported: false,
    })

    const formData = makeFormData({
      reservation_id: '1003',
      status: 'return_requested',
    })

    const { actions } = await import('../../routes/cms/reservation/+page.server')
    const result = await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    expect(result).not.toHaveProperty('status', 500)
    expect(mockRegisterReturn).toHaveBeenCalledWith('DHERO-BOOK-002')
  })

  it('케이스 3 (EC-1) — cancelled 전이 + tracking_number 있음 → cancelDelivery 호출, 성공', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1004,
      status: 'shipped',
      pickupMethod: 'crazydelivery',
      returnMethod: 'crazydelivery',
      trackingNumber: 'DHERO-BOOK-003',
      reservationCode: 'CS-2026-CANCEL',
      dheroStatus: '배송접수', dheroStatusCode: 0, dheroSyncedAt: null,
      dheroDongGroup: null, dheroReturnBookId: null, dheroMeta: null,
      customerName: '박민수',
      customerPhone: '010-7777-6666',
      address: '대구시 중구 동성로 1',
      addressDetail: null,
      postalCode: '41931',
      productName: 'DJI Mavic 3',

    })
    mockCancelDelivery.mockResolvedValue(undefined) // 성공

    const formData = makeFormData({
      reservation_id: '1004',
      status: 'cancelled',
    })

    const { actions } = await import('../../routes/cms/reservation/+page.server')
    const result = await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    expect(result).not.toHaveProperty('status', 500)
    expect(mockCancelDelivery).toHaveBeenCalledWith('DHERO-BOOK-003')
  })

  it('케이스 3 (EC-2) — cancelDelivery 412 실패(배송출발 이후) 시에도 예약취소 자체는 성공', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1005,
      status: 'shipped',
      pickupMethod: 'delivery',
      returnMethod: 'delivery',
      trackingNumber: 'DHERO-BOOK-004',
      reservationCode: 'CS-2026-FAIL-CANCEL',
      dheroStatus: '배송접수', dheroStatusCode: 0, dheroSyncedAt: null,
      dheroDongGroup: null, dheroReturnBookId: null, dheroMeta: null,
      customerName: '정수영',
      customerPhone: '010-6666-5555',
      address: '광주시 동구 충장로 1',
      addressDetail: null,
      postalCode: '61470',
      productName: 'Nikon Z9',
    })
    // 배송출발 이후 → 412 응답 → DheroApiError throw
    const { DheroApiError } = await import('$lib/server/dhero')
    mockCancelDelivery.mockRejectedValue(new DheroApiError('취소불가 상태', 412))

    const formData = makeFormData({
      reservation_id: '1005',
      status: 'cancelled',
    })

    const { actions } = await import('../../routes/cms/reservation/+page.server')
    const result = await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    // fail-soft: 예약취소 자체는 성공, 배송취소 실패는 경고만
    expect(result).not.toHaveProperty('status', 500)
    expect(mockRpc).toHaveBeenCalledWith('update_reservation_status', expect.objectContaining({ p_new_status: 'cancelled' }))
    // 경고 플래그가 결과에 포함됨
    expect(result).toMatchObject(
      expect.objectContaining({ dhero_cancel_failed: true }) // GREEN: 이 플래그가 있어야 함
    )
  })

  it('비bulk-delivery 방식(visit) shipped 전이 시 createDelivery 미호출', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    mockGetReservationForDhero.mockResolvedValue({
      reservationId: 1006,
      status: 'confirmed',
      pickupMethod: 'visit',
      returnMethod: 'visit',
      trackingNumber: null,
      reservationCode: 'CS-2026-VISIT',
      dheroStatus: null, dheroStatusCode: null, dheroSyncedAt: null,
      dheroDongGroup: null, dheroReturnBookId: null, dheroMeta: null,
      customerName: '최지원',
      customerPhone: '010-5555-4444',
      address: null,
      addressDetail: null,
      postalCode: null,
      productName: 'GoPro Hero 12',
    })
    // visit = NOT bulk delivery
    mockIsBulkDelivery.mockResolvedValue(false)

    const formData = makeFormData({
      reservation_id: '1006',
      status: 'shipped',
    })

    const { actions } = await import('../../routes/cms/reservation/+page.server')
    await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    expect(mockCreateDelivery).not.toHaveBeenCalled()
  })
})
