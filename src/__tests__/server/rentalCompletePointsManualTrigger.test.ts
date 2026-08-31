import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 대여완료(rental_complete) 포인트 자동적립 — 수동(CMS) 반납 경로 배선 검증
 * Harness Flow v3.2 — TDD (RED → GREEN)
 *
 * 대상: src/routes/cms/reservation/+page.server.ts updateStatus 액션
 *
 * 케이스:
 *   EC-1: newStatus === 'returned' 전이 성공 시 awardRentalCompletePoints 호출됨(예약ID 전달)
 *   EC-2: 'returned' 외 다른 상태 전이 시 awardRentalCompletePoints 미호출
 */

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

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

vi.mock('$lib/server/dhero', () => ({
  createDelivery: vi.fn(),
  cancelDelivery: vi.fn(),
  registerReturn: vi.fn(),
  DHERO_STATUS_LABEL: {},
  DheroApiError: class DheroApiError extends Error {
    statusCode: number
    constructor(msg: string, statusCode: number) { super(msg); this.statusCode = statusCode }
  },
  DheroNetworkError: class DheroNetworkError extends Error {},
}))

const mockGetReservationForDhero = vi.fn().mockResolvedValue(null)
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservationForDhero(...args),
}))

vi.mock('$lib/server/isBulkDeliveryMethod', () => ({
  isBulkDeliveryMethod: vi.fn().mockResolvedValue(false),
}))

vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/server/reservationApprovalNotify', () => ({
  resolveApprovalNotifyPlan: vi.fn(),
}))
vi.mock('$lib/server/sendApprovalNotifications', () => ({
  sendApprovalNotifications: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({
  clearIssuedContractContent: vi.fn(),
  discardSentContract: vi.fn(),
}))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: () => true,
}))

const mockAward = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/awardRentalCompletePoints', () => ({
  awardRentalCompletePoints: (...args: unknown[]) => mockAward(...args),
}))

function makeFormData(values: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(values).forEach(([k, v]) => fd.append(k, v))
  return fd
}

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'admin-uid' } } }),
    supabase: { rpc: vi.fn() },
  }
}

describe('updateStatus 액션 — 대여완료 포인트 자동적립 배선', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    mockGetReservationForDhero.mockResolvedValue(null)
  })

  it('EC-1: returned 전이 성공 시 awardRentalCompletePoints(admin, reservationId) 호출됨', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const formData = makeFormData({ reservation_id: '4001', status: 'returned' })
    const { actions } = await import('../../routes/cms/reservation/+page.server')

    await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    expect(mockAward).toHaveBeenCalledWith(expect.anything(), 4001)
  })

  it('EC-2: returned 외 상태(shipped)에서는 awardRentalCompletePoints 미호출', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const formData = makeFormData({ reservation_id: '4002', status: 'shipped' })
    const { actions } = await import('../../routes/cms/reservation/+page.server')

    await actions.updateStatus({
      request: { formData: async () => formData } as Request,
      locals: makeLocals(),
    } as unknown as Parameters<typeof actions.updateStatus>[0])

    expect(mockAward).not.toHaveBeenCalled()
  })
})
