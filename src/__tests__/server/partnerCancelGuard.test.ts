import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 파트너 예약취소 경로 가드 (2026-11-11 전수 점검 BLOCKER-1 수정 + 정책 결정: 파트너 ON 이면 신청대기만, OFF 이면 불가 + Migration 810 DB 원자 처리)
 *
 * 파트너는 환불·계약 취소 없이 '상태만' 취소하는 경로를 쓴다. 이 경로가 결제 완료·계약완료 이후 예약을 막지 않으면 "취소됐는데 환불 안 됨" 상태가 생긴다.
 * → 서버는 권한(rental.change_cancel ON)을 확인한 뒤 DB 함수 cancel_unpaid_reservations_for_partner 하나로 검사와 취소를 함께 처리한다
 *   (행 잠금 후 결제 전 pending·hold 만 취소 — 판정 로직 자체는 Stage DB 에서 롤백 트랜잭션으로 검증, 이 시험은 호출 규칙·결과 처리를 지킨다).
 */

vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))
vi.mock('@sveltejs/kit', () => ({ fail: (status: number, data?: Record<string, unknown>) => ({ status, data }) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))

const mockRpc = vi.fn()
let orderItemSiblings: number[] = []
let permRows: { menu_key: string; allowed: boolean }[] = []
let permError = false
let oiCalls = 0

function chain(result: () => { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) c[m] = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => result())
  c.single = vi.fn(async () => result())
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
  return c
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      if (table === 'order_items') {
        // 형제 예약 수집: 첫 조회(order_id) → { order_id }, 두 번째(형제 목록) → 행 배열
        const c = chain(() => (++oiCalls === 1 ? { data: { order_id: 1 }, error: null } : { data: orderItemSiblings.map((reservation_id) => ({ reservation_id })), error: null }))
        return c
      }
      if (table === 'cms_menu_permissions') return chain(() => (permError ? { data: null, error: { message: 'boom' } } : { data: permRows, error: null }))
      return chain(() => ({ data: null, error: null }))
    },
  }),
}))

let role = 'partner'
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => role }))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (r: string) => ['manager', 'superadmin'].includes(r),
  getRoleLevel: (r: string) => ({ superadmin: 100, manager: 50, partner: 10 })[r] ?? 0,
}))
vi.mock('$lib/server/dhero', () => ({
  createDelivery: vi.fn(), cancelDelivery: vi.fn(), registerReturn: vi.fn(),
  DHERO_STATUS_LABEL: {},
  DheroApiError: class DheroApiError extends Error { statusCode = 0 },
  DheroNetworkError: class DheroNetworkError extends Error {},
}))
vi.mock('$lib/server/getReservationForDhero', () => ({ getReservationForDhero: vi.fn(async () => null) }))
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({ isDheroIntegrationMethod: vi.fn(async () => false) }))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/reservationApprovalNotify', () => ({ resolveApprovalNotifyPlan: vi.fn() }))
vi.mock('$lib/server/clearIssuedContractHelper', () => ({ clearIssuedContractContent: vi.fn() }))

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.append(k, v)
  return f
}
const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin-uid' } } }), supabase: { rpc: vi.fn() } }

async function runCancel() {
  const { actions } = await import('../../routes/cms/reservation/+page.server')
  const handler = (actions as unknown as Record<string, (e: unknown) => Promise<unknown>>).updateStatus
  return handler({ request: { formData: async () => fd({ reservation_id: '10', status: 'cancelled' }) }, locals })
}

describe('파트너 예약취소 — 권한 확인 후 DB 원자 취소 함수로 처리', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: { ok: true, cancelled_ids: [10] }, error: null })
    role = 'partner'
    orderItemSiblings = [10]
    permError = false
    oiCalls = 0
    permRows = [{ menu_key: 'rental.change_cancel', allowed: true }] // 파트너 ON(임시 권한 제어 오픈 2026-11-11)
  })

  it('ON 파트너: DB 함수에 대표 예약과 형제 id 전체를 넘기고, 상태 전환 RPC 를 TS 가 직접 호출하지 않는다', async () => {
    orderItemSiblings = [10, 11]
    mockRpc.mockResolvedValue({ data: { ok: true, cancelled_ids: [10, 11] }, error: null })
    const r = (await runCancel()) as { status?: number }
    expect(r.status).toBeUndefined()
    expect(mockRpc).toHaveBeenCalledWith('cancel_unpaid_reservations_for_partner', { p_primary_id: 10, p_reservation_ids: [10, 11] })
    expect(mockRpc).not.toHaveBeenCalledWith('update_reservation_status', expect.anything())
  })

  it('DB 가 NOT_ALLOWED(결제 완료·계약완료 이후·결제 흔적)로 거절하면 403 으로 돌려준다', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, code: 'NOT_ALLOWED', error: '결제가 끝났거나 계약완료 이후인 예약은 매니저 이상만 취소(환불 포함)할 수 있습니다.' }, error: null })
    const r = (await runCancel()) as { status: number; data?: { message?: string } }
    expect(r.status).toBe(403)
    expect(r.data?.message).toContain('매니저 이상')
  })

  it('DB 함수 호출 오류는 500, 처리 실패(FAILED)도 500, 그 외 거절은 400', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(((await runCancel()) as { status: number }).status).toBe(500)
    mockRpc.mockResolvedValue({ data: { ok: false, code: 'FAILED', error: 'x' }, error: null })
    expect(((await runCancel()) as { status: number }).status).toBe(500)
    mockRpc.mockResolvedValue({ data: { ok: false, code: 'NOT_FOUND', error: '예약을 찾을 수 없습니다.' }, error: null })
    expect(((await runCancel()) as { status: number }).status).toBe(400)
  })

  it('정책: 파트너가 \'예약변경 및 취소\' OFF(기록 없음·기본)이면 DB 함수를 호출하지 않고 403', async () => {
    permRows = []
    const r = (await runCancel()) as { status: number }
    expect(r.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalledWith('cancel_unpaid_reservations_for_partner', expect.anything())
  })

  it('정책: 계정별 OFF(allowed=false) 기록이 있으면 호출하지 않고 403', async () => {
    permRows = [{ menu_key: 'rental.change_cancel', allowed: false }]
    const r = (await runCancel()) as { status: number }
    expect(r.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalledWith('cancel_unpaid_reservations_for_partner', expect.anything())
  })

  it('권한 조회가 실패하면 취소하지 않는다(fail-closed, 500)', async () => {
    permError = true
    const r = (await runCancel()) as { status: number }
    expect(r.status).toBe(500)
    expect(mockRpc).not.toHaveBeenCalledWith('cancel_unpaid_reservations_for_partner', expect.anything())
  })
})
