import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/accounts createAccount — 기존 가입 계정의 관리자 전환(고아 계정 재사용) 제한
 * (2026-10-24, sp5 SEC-003)
 *
 * 배경: 이미 가입된 이메일이면 "cms_role 이 없는 계정 = 고아 계정"으로 보고 그대로 관리자로 바꾸고 비밀번호 설정 링크를 발급했다.
 * → 매니저(또는 탈취된 매니저 계정)가 일반 고객 이메일로 "관리자 계정 생성"을 누르면 그 고객 계정이 넘어간다.
 * 규칙: 로그인한 적이 있거나 예약 이력이 있는 계정은 일반 회원 계정이므로 재사용을 거절한다.
 *       한 번도 쓰이지 않은 진짜 고아 계정(로그인 이력 없음·예약 없음)만 기존처럼 재사용한다.
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/requireTrueSuperadmin', () => ({ requireTrueSuperadmin: async () => null }))
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: vi.fn(async () => undefined) }))

type Existing = { id: string; email: string; last_sign_in_at: string | null }
let existingUser: Existing
let profileCmsRole: string | null
let reservationCount: number | null
let reservationError: { message: string } | null
const rpcCalls: string[] = []

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'limit']) c[m] = vi.fn(() => c)
  c.single = vi.fn().mockResolvedValue(result)
  c.maybeSingle = vi.fn().mockResolvedValue(result)
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return c
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } })),
        listUsers: vi.fn(async () => ({ data: { users: [existingUser] } })),
      },
    },
    from: (table: string) => {
      if (table === 'user_profiles') return chain({ data: { cms_role: profileCmsRole }, error: null })
      if (table === 'rental_reservations') return chain({ data: null, error: reservationError, count: reservationCount })
      return chain({ data: null, error: null })
    },
    rpc: vi.fn(async (name: string) => {
      rpcCalls.push(name)
      return { data: name === 'cms_create_invite_token' ? 'tok123' : null, error: null }
    }),
  }),
}))

import { actions } from '../../routes/cms/accounts/+page.server'

function formRequest() {
  const fd = new FormData()
  fd.set('name', '홍길동')
  fd.set('email', 'target@example.com')
  fd.set('phone', '010-1234-5678')
  fd.set('cms_role', 'manager')
  return { formData: async () => fd } as unknown as Request
}

async function run() {
  const locals = { safeGetSession: async () => ({ session: { user: { id: 'caller-1' } } }) }
  return (actions.createAccount as unknown as (e: unknown) => Promise<{ status?: number; data?: Record<string, unknown>; success?: boolean }>)({
    request: formRequest(),
    locals,
  })
}

beforeEach(() => {
  rpcCalls.length = 0
  existingUser = { id: 'u-existing', email: 'target@example.com', last_sign_in_at: null }
  profileCmsRole = null
  reservationCount = 0
  reservationError = null
})

describe('createAccount — 기존 가입 계정 재사용 제한', () => {
  it('로그인 이력이 있는 일반 회원 이메일은 관리자로 전환하지 않는다', async () => {
    existingUser.last_sign_in_at = '2026-10-01T00:00:00Z'
    const r = await run()
    expect(r.status).toBe(400)
    expect(String(r.data?.error)).toContain('일반 회원')
    expect(rpcCalls).not.toContain('cms_setup_admin_profile')
    expect(rpcCalls).not.toContain('cms_create_invite_token')
  })

  it('예약 이력이 있는 계정은 로그인 이력이 없어도 전환하지 않는다', async () => {
    reservationCount = 2
    const r = await run()
    expect(r.status).toBe(400)
    expect(rpcCalls).not.toContain('cms_setup_admin_profile')
    expect(rpcCalls).not.toContain('cms_create_invite_token')
  })

  it('이미 관리자 등급이 있는 계정은 기존처럼 중복 오류', async () => {
    profileCmsRole = 'partner'
    const r = await run()
    expect(r.status).toBe(400)
    expect(String(r.data?.error)).toContain('이미 등록된 관리자')
    expect(rpcCalls).not.toContain('cms_setup_admin_profile')
  })

  it('한 번도 쓰이지 않은 진짜 고아 계정(로그인·예약 없음)은 기존처럼 재사용한다', async () => {
    const r = await run()
    expect(r.success).toBe(true)
    expect(rpcCalls).toContain('cms_setup_admin_profile')
    expect(rpcCalls).toContain('cms_create_invite_token')
  })

  it('예약 이력 조회 중 오류가 나면 안전하게 거절한다', async () => {
    reservationError = { message: 'db down' }
    reservationCount = null
    const r = await run()
    expect(r.status).toBe(400)
    expect(rpcCalls).not.toContain('cms_setup_admin_profile')
    expect(rpcCalls).not.toContain('cms_create_invite_token')
  })

  it('예약 건수가 비어 오면(null) 예약 없음으로 보고 고아 계정은 재사용한다', async () => {
    reservationCount = null
    const r = await run()
    expect(r.success).toBe(true)
    expect(rpcCalls).toContain('cms_setup_admin_profile')
  })
})
