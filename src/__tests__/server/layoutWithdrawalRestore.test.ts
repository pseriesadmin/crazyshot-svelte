import { describe, it, expect, vi } from 'vitest'

/** 루트 레이아웃 — 탈퇴 유예 중 로그인 처리 (2026-10-24): 본인 탈퇴는 자동 복구 + 안내 플래그, 관리자 삭제는 복구하지 않고 로그아웃 */
vi.mock('$lib/services/serviceInfoSettings', () => ({ getServiceInfoSettings: async () => ({ company_name: 'c' }) }))
const { load } = await import('../../routes/+layout.server')

function makeEvent(profileStatus: string, restore: { restored?: boolean; admin_blocked?: boolean } | null) {
  const signOut = vi.fn(async () => ({}))
  const rpc = vi.fn(async () => ({ data: restore, error: null }))
  const event = {
    locals: {
      safeGetSession: async () => ({ session: { user: { id: 'u1' } } }),
      supabase: {
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { withdrawal_status: profileStatus, withdrawal_purge_at: null } }) }) }) }),
        rpc,
        auth: { signOut },
      },
    },
  } as never
  return { event, signOut, rpc }
}

describe('+layout.server 탈퇴 유예 처리', () => {
  it('본인 탈퇴 복구 → withdrawalRestored 플래그(모달 표시용)', async () => {
    const { event, signOut } = makeEvent('requested', { restored: true })
    const r = (await load(event)) as Record<string, unknown>
    expect(r.withdrawalRestored).toBe(true)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('관리자 삭제 계정 → 복구하지 않고 로그아웃 + accountNotice', async () => {
    const { event, signOut } = makeEvent('requested', { restored: false, admin_blocked: true })
    const r = (await load(event)) as Record<string, unknown>
    expect(r.accountNotice).toBe('admin_deleted')
    expect(r.withdrawalRestored).toBeUndefined()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('정상 계정은 복구 호출 없이 통과', async () => {
    const { event, rpc } = makeEvent('none', null)
    const r = (await load(event)) as Record<string, unknown>
    expect(rpc).not.toHaveBeenCalled()
    expect(r.withdrawalRestored).toBeUndefined()
  })
})
