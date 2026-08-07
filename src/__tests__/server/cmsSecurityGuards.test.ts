import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-SEC-1 — CMS 보안 가드: 인증/권한 없이 action 호출 시 401/403 반환 검증
 *
 * 대상 파일:
 *   1. src/routes/cms/accounts/+page.server.ts — createAccount action
 *      현재 결함: ({ request }) 만 받음 — locals 미사용, session 체크 없음
 *   2. src/routes/cms/promotion/rules/+page.server.ts — createRule/toggleRule/deleteRule
 *      현재 결함: locals.safeGetSession() 호출 없어 인증 우회 가능
 *
 * RED 확인: 현재 코드는 401/403을 반환하지 않음 → 테스트 FAIL
 * GREEN 목표: session 없음 → fail(401), role 없음/부족 → fail(403)
 *
 * 참조: security-auth.md "표준 패턴 — getCmsRoleForAction + hasSettingsAccess"
 */

// ── 모듈 모킹 (vi.mock은 자동 호이스팅) ──────────────────────────────────────

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location });
  },
}));

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Mock: should not reach createUser when auth guard is active' },
        }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    },
  }),
}));

// getCmsRoleForAction 모킹 — 각 테스트에서 mockResolvedValue로 제어
const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  getRoleLevel: (role: string) =>
    ({ superadmin: 100, manager: 50, partner: 10 } as Record<string, number>)[role] ?? 0,
}));

// ── 동적 import (vi.mock 호이스팅 이후에 실행됨) ──────────────────────────────
const { actions: accountActions } = await import('../../routes/cms/accounts/+page.server');
const { actions: rulesActions } = await import('../../routes/cms/promotion/rules/+page.server');

// ── 스텁 팩토리 ──────────────────────────────────────────────────────────────

function makeUnauthLocals() {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: null }),
    supabase: makeSupabaseStub(),
    cmsRole: undefined as string | undefined,
  };
}

function makeAuthLocals(cmsRoleValue: string | null = null) {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'test-user-id' } } }),
    supabase: makeSupabaseStub(),
    cmsRole: undefined as string | undefined,
  };
}

function makeSupabaseStub() {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { from: vi.fn().mockReturnValue(chainable) };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

// ── [이슈 1] accounts createAccount 보안 가드 테스트 ─────────────────────────

describe('[TDD-SEC-1] accounts — createAccount 인증/권한 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RED → GREEN: 세션 없이 createAccount 호출 시 401 반환해야 한다', async () => {
    const event = {
      request: makeRequest({
        name: '테스트 관리자',
        email: 'admin@test.com',
        phone: '01012345678',
        cms_role: 'manager',
        cms_allow_concurrent_login: 'false',
        cms_session_timeout_hours: 'false',
      }),
      locals: makeUnauthLocals(),
    };

    const result = await (
      accountActions as Record<string, (e: unknown) => Promise<unknown>>
    ).createAccount(event);

    // RED: 현재 action은 locals를 사용하지 않으므로 401이 아닌 500이 반환됨
    // GREEN: 세션 체크 후 fail(401, { error: '인증 필요' }) 반환
    expect(result).toMatchObject({ status: 401 });
  });

  it('RED → GREEN: CMS 역할 없는 사용자가 createAccount 호출 시 403 반환해야 한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue(null);

    const event = {
      request: makeRequest({
        name: '테스트',
        email: 'test@test.com',
        phone: '01012345678',
        cms_role: 'manager',
        cms_allow_concurrent_login: 'false',
        cms_session_timeout_hours: 'false',
      }),
      locals: makeAuthLocals(null),
    };

    const result = await (
      accountActions as Record<string, (e: unknown) => Promise<unknown>>
    ).createAccount(event);

    // GREEN: getCmsRoleForAction → null → fail(403, { error: '권한 없음' })
    expect(result).toMatchObject({ status: 403 });
  });

  it('RED → GREEN: partner 역할로 createAccount 호출 시 403 반환해야 한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');

    const event = {
      request: makeRequest({
        name: '파트너',
        email: 'partner@test.com',
        phone: '01012345678',
        cms_role: 'manager',
        cms_allow_concurrent_login: 'false',
        cms_session_timeout_hours: 'false',
      }),
      locals: makeAuthLocals('partner'),
    };

    const result = await (
      accountActions as Record<string, (e: unknown) => Promise<unknown>>
    ).createAccount(event);

    // GREEN: hasSettingsAccess('partner') = false → fail(403, { error: '권한 없음' })
    expect(result).toMatchObject({ status: 403 });
  });
});

// ── [이슈 2] promotion/rules actions 보안 가드 테스트 ─────────────────────────

describe('[TDD-SEC-1] promotion/rules — createRule 인증 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RED → GREEN: 세션 없이 createRule 호출 시 401 반환해야 한다', async () => {
    const event = {
      request: makeRequest({
        name: '테스트 규칙',
        trigger_type: 'signup',
        action_type: 'grant_point',
      }),
      locals: makeUnauthLocals(),
    };

    const result = await (
      rulesActions as Record<string, (e: unknown) => Promise<unknown>>
    ).createRule(event);

    // RED: 현재 session 체크 없어 { success: true } 반환됨
    // GREEN: fail(401, { error: '인증 필요' }) 반환
    expect(result).toMatchObject({ status: 401 });
  });

  it('RED → GREEN: partner 역할로 createRule 호출 시 403 반환해야 한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');

    const event = {
      request: makeRequest({
        name: '파트너 규칙',
        trigger_type: 'signup',
        action_type: 'grant_point',
      }),
      locals: makeAuthLocals('partner'),
    };

    const result = await (
      rulesActions as Record<string, (e: unknown) => Promise<unknown>>
    ).createRule(event);

    expect(result).toMatchObject({ status: 403 });
  });
});

describe('[TDD-SEC-1] promotion/rules — toggleRule 인증 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RED → GREEN: 세션 없이 toggleRule 호출 시 401 반환해야 한다', async () => {
    const event = {
      request: makeRequest({ id: 'rule-id-abc', is_active: 'true' }),
      locals: makeUnauthLocals(),
    };

    const result = await (
      rulesActions as Record<string, (e: unknown) => Promise<unknown>>
    ).toggleRule(event);

    expect(result).toMatchObject({ status: 401 });
  });
});

describe('[TDD-SEC-1] promotion/rules — deleteRule 인증 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RED → GREEN: 세션 없이 deleteRule 호출 시 401 반환해야 한다', async () => {
    const event = {
      request: makeRequest({ id: 'rule-id-abc' }),
      locals: makeUnauthLocals(),
    };

    const result = await (
      rulesActions as Record<string, (e: unknown) => Promise<unknown>>
    ).deleteRule(event);

    expect(result).toMatchObject({ status: 401 });
  });
});
