import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null })) // 1e 메뉴권한 게이트 통과(게이트 자체는 customersMenuGuard.test.ts에서 검증)

/**
 * POST /api/cms/approve-doc — 필수 서류 조합 게이트 (2026-10-02, Stephen 확정)
 *
 * 완료기준:
 *   정상동작: 필수 조합을 모두 갖춘 증명은 approve_customer_doc RPC까지 진행한다.
 *   막아야할것: 일부만 등록된 증명(화면 버튼을 우회한 직접 호출 포함)은 RPC 호출 전에 400으로 거절된다.
 *   필수 조합 — 본인증명: (resident|driver) + resident_copy / 외국인증명: 체류 유형별 4종 전부(단기 4종 | 장기 4종)
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(async () => ({ delivered: false })) }))

const mockRpc = vi.fn()
const profileRef: { row: { identity_type: string[] | null; foreign_type: string[] | null } | null } = { row: null }
function makeChain() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => ({ data: profileRef.row, error: null })
  chain.insert = async () => ({ error: null })
  chain.update = () => chain
  return chain
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: () => makeChain() }),
}))

const { POST } = await import('../../routes/api/cms/approve-doc/+server')

function ev(type: 'identity' | 'foreign') {
  return {
    request: { json: async () => ({ user_id: 'customer-uid', type }) },
    locals: { safeGetSession: async () => ({ session: { user: { id: 'admin-uid' } } }) },
  } as unknown as Parameters<typeof POST>[0]
}
type R = { status: number; data: { ok: boolean; error?: string } }
const approveRpcCalled = () => mockRpc.mock.calls.some((c) => c[0] === 'approve_customer_doc')

describe('POST /api/cms/approve-doc — 필수 서류 조합', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'approve_customer_doc' ? { data: { ok: true, approved_at: new Date().toISOString() }, error: null } : { data: null, error: null })
  })

  it('본인증명: 주민등록증만(등본 누락) → 400, RPC 호출 없음', async () => {
    profileRef.row = { identity_type: ['resident'], foreign_type: null }
    const r = (await POST(ev('identity'))) as unknown as R
    expect(r.status).toBe(400)
    expect(r.data.error).toContain('필수 서류')
    expect(approveRpcCalled()).toBe(false)
  })

  it('본인증명: 주민등록등본만 → 400', async () => {
    profileRef.row = { identity_type: ['resident_copy'], foreign_type: null }
    expect(((await POST(ev('identity'))) as unknown as R).status).toBe(400)
    expect(approveRpcCalled()).toBe(false)
  })

  it('본인증명: 주민등록증 + 등본 → 승인(RPC 호출)', async () => {
    profileRef.row = { identity_type: ['resident', 'resident_copy'], foreign_type: null }
    const r = (await POST(ev('identity'))) as unknown as R
    expect(r.data.ok).toBe(true)
    expect(approveRpcCalled()).toBe(true)
  })

  it('본인증명: 운전면허증 + 등본 → 승인', async () => {
    profileRef.row = { identity_type: ['driver', 'resident_copy'], foreign_type: null }
    expect(((await POST(ev('identity'))) as unknown as R).data.ok).toBe(true)
  })

  it('외국인증명: 일부만 → 400 / 단기 4종 전부 → 승인 / 장기 4종 전부 → 승인', async () => {
    profileRef.row = { identity_type: null, foreign_type: ['passport_photo'] }
    expect(((await POST(ev('foreign'))) as unknown as R).status).toBe(400)

    profileRef.row = { identity_type: null, foreign_type: ['passport_photo', 'accommodation_reservation'] }
    expect(((await POST(ev('foreign'))) as unknown as R).status).toBe(400)

    profileRef.row = { identity_type: null, foreign_type: ['passport_photo', 'arc_front', 'arc_back'] }
    expect(((await POST(ev('foreign'))) as unknown as R).status).toBe(400)
    expect(approveRpcCalled()).toBe(false)

    profileRef.row = { identity_type: null, foreign_type: ['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'] }
    expect(((await POST(ev('foreign'))) as unknown as R).data.ok).toBe(true)

    profileRef.row = { identity_type: null, foreign_type: ['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'] }
    expect(((await POST(ev('foreign'))) as unknown as R).data.ok).toBe(true)
  })

  it('본인증명 필수 조합이 있어도 외국인증명을 승인 요청하면 외국인증명 기준으로 판정(교차 승인 불가)', async () => {
    profileRef.row = { identity_type: ['resident', 'resident_copy'], foreign_type: ['passport_photo'] }
    expect(((await POST(ev('foreign'))) as unknown as R).status).toBe(400)
  })

  it('사용자 없음 → 404', async () => {
    profileRef.row = null
    expect(((await POST(ev('identity'))) as unknown as R).status).toBe(404)
  })
})
