import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/cms/approve-doc — 권한 게이트 회귀 테스트 (Migration #526)
 *
 * 완료기준(B-START):
 *   정상동작: manager/superadmin은 게이트를 통과해 RPC 호출 단계까지 진행한다.
 *   막아야할것: 미로그인·partner 등급은 RPC 호출 전에 403으로 차단된다
 *              (cms/upload-doc·toggle_blacklist와 동일한 hasSettingsAccess(manager+) 기준).
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://example.supabase.co',
}))

vi.mock('$lib/server/push', () => ({
  sendPushToUser: vi.fn(async () => ({ delivered: false, reason: 'skipped' })),
}))

const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: vi.fn() }),
}))

const { POST } = await import('../../routes/api/cms/approve-doc/+server')

function makeEvent(session: { user: { id: string } } | null) {
  return {
    request: {
      json: async () => ({ user_id: 'customer-uid', type: 'identity' }),
    },
    locals: {
      safeGetSession: async () => ({ session }),
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/cms/approve-doc — 권한 게이트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: { ok: true, approved_at: new Date().toISOString() }, error: null })
  })

  it('미로그인 — 403, RPC 호출 없음', async () => {
    const result = (await POST(makeEvent(null))) as unknown as { status: number; data: { ok: boolean } }
    expect(result.status).toBe(403)
    expect(result.data.ok).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('partner 등급 — 403, RPC 호출 없음', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner')
    const result = (await POST(makeEvent({ user: { id: 'admin-uid' } }))) as unknown as {
      status: number
      data: { ok: boolean }
    }
    expect(result.status).toBe(403)
    expect(result.data.ok).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('manager 등급 — 게이트 통과, approve_customer_doc RPC 호출됨', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    const result = (await POST(makeEvent({ user: { id: 'admin-uid' } }))) as unknown as {
      status: number
      data: { ok: boolean }
    }
    expect(result.status).toBe(200)
    expect(result.data.ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith(
      'approve_customer_doc',
      expect.objectContaining({ p_user_id: 'customer-uid', p_doc_type: 'identity' }),
    )
  })

  it('superadmin 등급 — 게이트 통과', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('superadmin')
    const result = (await POST(makeEvent({ user: { id: 'admin-uid' } }))) as unknown as { status: number }
    expect(result.status).toBe(200)
  })
})
