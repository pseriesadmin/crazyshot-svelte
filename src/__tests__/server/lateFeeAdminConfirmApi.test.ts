import { describe, it, expect, vi, beforeEach } from 'vitest'

/** /api/cms/reservations/[id]/late-fees — 관리자 [결제 확인] 권한·검증·알림 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))

const menuDenied = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => menuDenied(...a) }))
const roleMock = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => roleMock(...a) }))
const auditMock = vi.fn()
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: (...a: unknown[]) => auditMock(...a) }))
const notifyMock = vi.fn()
vi.mock('$lib/server/lateFeeNotify', () => ({ notifyLateFeePaid: (...a: unknown[]) => notifyMock(...a) }))

const rpcMock = vi.fn()
let ownRow: { id: string } | null = { id: 'x' }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.maybeSingle = () => Promise.resolve({ data: ownRow })
      return c
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
}))

const { POST } = await import('../../routes/api/cms/reservations/[id]/late-fees/+server')

const FEE_ID = '11111111-1111-4111-8111-111111111111'

function ev(body: unknown, opts: { session?: boolean } = {}) {
  return {
    params: { id: '55' },
    request: { json: async () => body },
    locals: { safeGetSession: async () => ({ session: opts.session === false ? null : { user: { id: 'admin-1' } } }) },
  } as unknown as Parameters<typeof POST>[0]
}
type Res = { status: number; data: Record<string, unknown> }

describe('POST /api/cms/reservations/[id]/late-fees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    menuDenied.mockResolvedValue(null)
    roleMock.mockResolvedValue('manager')
    ownRow = { id: FEE_ID }
    rpcMock.mockResolvedValue({ data: { ok: true, reservation_id: 55, fee_amount: 12000 }, error: null })
    notifyMock.mockResolvedValue(undefined)
  })

  it('메뉴 권한이 없으면 거부한다', async () => {
    menuDenied.mockResolvedValue({ status: 403, data: { error: 'no' } })
    const res = (await POST(ev({ late_fee_id: FEE_ID }))) as unknown as Res
    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('partner(매니저 미만)는 결제 확인을 못 한다', async () => {
    roleMock.mockResolvedValue('partner')
    const res = (await POST(ev({ late_fee_id: FEE_ID }))) as unknown as Res
    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('UUID 형식이 아니면 400', async () => {
    const res = (await POST(ev({ late_fee_id: 'abc' }))) as unknown as Res
    expect(res.status).toBe(400)
  })

  it('다른 예약의 연체료 ID면 404 — 확인 처리하지 않는다', async () => {
    ownRow = null
    const res = (await POST(ev({ late_fee_id: FEE_ID }))) as unknown as Res
    expect(res.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('성공하면 관리자 id로 결제 확인 RPC를 호출하고 고객 알림을 보낸다', async () => {
    const res = (await POST(ev({ late_fee_id: FEE_ID }))) as unknown as Res
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('admin_confirm_late_fee_paid', { p_late_fee_id: FEE_ID, p_admin_id: 'admin-1' })
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), { lateFeeId: FEE_ID, reservationId: 55, feeAmount: 12000 })
    // 감사로그 — 누가·어느 연체료·얼마를 확인했는지
    expect(auditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorId: 'admin-1', actionType: 'late_fee_confirm' }))
  })

  it('이미 결제된 연체료(409)면 알림을 보내지 않는다', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, error: '이미 결제 완료된 연체료입니다.', status: 409 }, error: null })
    const res = (await POST(ev({ late_fee_id: FEE_ID }))) as unknown as Res
    expect(res.status).toBe(409)
    expect(notifyMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
