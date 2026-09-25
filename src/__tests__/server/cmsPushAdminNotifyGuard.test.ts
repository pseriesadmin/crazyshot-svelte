import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/set/push updateAdminNotify — 마스터(superadmin) 대상 게이트 회귀 테스트 (2026-09-25)
 * manager가 superadmin 계정의 관리자 알림 수신 설정을 바꿀 수 없어야 하고,
 * manager가 partner/manager 대상을 바꾸는 기존 시나리오는 그대로 동작해야 한다.
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  getRoleLevel: (role: string) => ({ superadmin: 100, manager: 50, partner: 10 })[role] ?? 0,
  ROLE_LEVEL: { superadmin: 100, manager: 50, partner: 10 },
}))

const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: () => mockRole() }))

const mockProfile = vi.fn()
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...a: unknown[]) => mockProfile(...a),
}))

const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockRpc }) }))

import { actions } from '../../routes/cms/set/push/+page.server'

const CALLER = 'caller-id'
const SUPER = 'super-id'
const PARTNER = 'partner-id'

function callAction(target: string) {
  const fd = new FormData()
  fd.set('target_user_id', target)
  fd.set('event_key', 'new_reservation')
  fd.set('enabled', 'false')
  const locals = { safeGetSession: async () => ({ session: { user: { id: CALLER } } }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (actions.updateAdminNotify as any)({ request: { formData: async () => fd }, locals })
}

function profiles(callerRole: string) {
  mockProfile.mockImplementation(async (_a: unknown, id: string) => {
    if (id === CALLER) return { cms_role: callerRole }
    if (id === SUPER) return { cms_role: 'superadmin' }
    return { cms_role: 'partner' }
  })
}

describe('updateAdminNotify 마스터 대상 게이트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
  })

  it('manager가 superadmin 대상 변경 시 403, RPC 미호출', async () => {
    mockRole.mockResolvedValue('manager')
    profiles('manager')
    const res = await callAction(SUPER)
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('manager가 partner 대상 변경은 통과', async () => {
    mockRole.mockResolvedValue('manager')
    profiles('manager')
    const res = await callAction(PARTNER)
    expect(res).toEqual({ ok: true, action: 'updateAdminNotify' })
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('superadmin이 superadmin 대상 변경은 통과', async () => {
    mockRole.mockResolvedValue('superadmin')
    profiles('superadmin')
    const res = await callAction(SUPER)
    expect(res).toEqual({ ok: true, action: 'updateAdminNotify' })
  })
})
