import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/promotion/point saveUseSettings — '자동 소멸 기한'(expiry_days) 입력 검증 (Migration #742, sp3 3차 N3)
 * 빈 칸은 Number('')=0 으로 '소멸 없음'이 조용히 저장되던 문제 → 빈 값은 거절하고, 0은 직접 입력해야 한다.
 */

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
}))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}))

import { actions } from '../../routes/cms/promotion/point/+page.server'

type Result = { ok: boolean; error?: string }

async function save(fields: Record<string, string | null>): Promise<Result> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== null) fd.set(k, v)
  const run = actions.saveUseSettings as unknown as (e: unknown) => Promise<Result>
  return run({
    request: { formData: async () => fd },
    locals: { safeGetSession: async () => ({ session: { user: { id: 'u1' } } }) },
  })
}

const base = { use_enabled: 'true', min_use_points: '0', use_unit: '1', max_use_ratio: '100' }

beforeEach(() => {
  mockRpc.mockReset()
  mockRpc.mockResolvedValue({ error: null })
  mockGetCmsRoleForAction.mockReset()
  mockGetCmsRoleForAction.mockResolvedValue('manager')
})

describe('saveUseSettings — expiry_days 입력 검증', () => {
  it('빈 값·공백·필드 누락은 거절하고 저장(RPC)을 호출하지 않는다', async () => {
    for (const v of ['', '   ', null]) {
      const r = await save({ ...base, expiry_days: v })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('입력')
    }
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('0은 직접 입력하면 정상 저장(소멸 없음)', async () => {
    const r = await save({ ...base, expiry_days: '0' })
    expect(r.ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('upsert_point_use_settings', expect.objectContaining({ p_expiry_days: 0 }))
  })

  it('정상 값 저장, 범위 밖·소수·문자는 거절', async () => {
    expect((await save({ ...base, expiry_days: '30' })).ok).toBe(true)
    expect(mockRpc).toHaveBeenLastCalledWith('upsert_point_use_settings', expect.objectContaining({ p_expiry_days: 30 }))
    mockRpc.mockClear()
    for (const v of ['-1', '3651', '1.5', 'abc']) {
      expect((await save({ ...base, expiry_days: v })).ok).toBe(false)
    }
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('manager 미만(partner)은 저장할 수 없다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner')
    const r = await save({ ...base, expiry_days: '30' })
    expect(r.ok).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
