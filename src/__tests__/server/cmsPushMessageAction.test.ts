import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/set/push updatePushMessage — 알림 안내문장 저장 액션 (2026-10-10)
 *  - manager 이상만 / 서버가 화면과 같은 규칙으로 재검증(허용 변수·문자 규격) / 빈 문장 = 기본 문구 복원
 *  - 저장 성공 시 감사로그(push_message_change)에 전후 값 기록
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
vi.mock('$lib/server/requireTrueSuperadmin', () => ({ requireAccountMutationAccess: async () => null }))

const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: () => mockRole() }))

const mockRpc = vi.fn()
const mockAudit = vi.fn()
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: (...a: unknown[]) => mockAudit(...a) }))

let beforeExtra: Record<string, unknown> = {}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { extra_config: beforeExtra }, error: null }) }) }),
    }),
  }),
}))

import { actions } from '../../routes/cms/set/push/+page.server'

function call(notifyType: string, message: string, role = 'manager') {
  mockRole.mockResolvedValue(role)
  const fd = new FormData()
  fd.set('notify_type', notifyType)
  fd.set('message', message)
  const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin-1' } } }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (actions.updatePushMessage as any)({ request: { formData: async () => fd }, locals })
}

beforeEach(() => {
  vi.clearAllMocks()
  beforeExtra = {}
  mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
})

describe('updatePushMessage', () => {
  it('partner는 403, RPC 미호출', async () => {
    const res = await call('return_remind', '안내', 'partner')
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('허용되지 않은 변수는 400, RPC 미호출', async () => {
    const res = await call('chat_unanswered', '{{상품명}} 안내')
    expect(res.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('문자 대상에 이모지는 400', async () => {
    const res = await call('return_remind', '반납 안내 🎉')
    expect(res.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('2000바이트 초과는 400', async () => {
    const res = await call('return_remind', '가'.repeat(999))
    expect(res.status).toBe(400)
  })

  it('정상 저장 — RPC 호출 + 감사로그(전후 값)', async () => {
    beforeExtra = { message: '이전 문장' }
    const res = await call('return_remind', '  {{상품명}} 반납일이에요.  ')
    expect(res.ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('update_push_notification_message', { p_notify_type: 'return_remind', p_message: '{{상품명}} 반납일이에요.' })
    expect(mockAudit).toHaveBeenCalledTimes(1)
    const entry = mockAudit.mock.calls[0][1] as { actionType: string; beforeValue: { message: string | null }; afterValue: { message: string | null } }
    expect(entry.actionType).toBe('push_message_change')
    expect(entry.beforeValue.message).toBe('이전 문장')
    expect(entry.afterValue.message).toBe('{{상품명}} 반납일이에요.')
  })

  it('빈 문장은 기본 문구 복원(빈 문자열로 RPC)', async () => {
    beforeExtra = { message: '이전 문장' }
    const res = await call('return_remind', '   ')
    expect(res.ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('update_push_notification_message', { p_notify_type: 'return_remind', p_message: '' })
    const entry = mockAudit.mock.calls[0][1] as { afterValue: { message: string | null } }
    expect(entry.afterValue.message).toBeNull()
  })

  it('RPC가 notify_type_not_found 를 돌려주면 400, 감사로그 없음', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'notify_type_not_found' }, error: null })
    const res = await call('return_remind', '안내')
    expect(res.status).toBe(400)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
