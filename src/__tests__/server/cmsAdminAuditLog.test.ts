import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * cms_admin_audit_log — CMS 관리자 계정 민감 액션 감사로그 + 마지막마스터 보호(Q4)
 * (2026-08-26, harness TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 7)
 *
 * 대상 이벤트: role_change(updateRole) / create(createAccount, superadmin 생성 시) /
 * delete / suspend(toggleSuspend) / menu_permission_change(PUT menu-permissions) +
 * 추가 커버리지: concurrent_login_change(toggleConcurrent) / session_limit_change
 * (toggleSession) / name_change(updateName)
 *
 * EC-3: superadmin이 정확히 1명 남은 상태에서 그 계정을 강등(updateRole)하거나
 * 삭제(delete)하려 하면 호출자가 진짜 superadmin이어도 거부돼야 한다.
 * EC-4 회귀: superadmin이 2명 이상이면 정상적으로 강등/삭제가 통과한다.
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location });
  },
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  hasRouteAccess: () => true,
  getRoleLevel: (role: string) =>
    ({ superadmin: 100, manager: 50, partner: 10 } as Record<string, number>)[role] ?? 0,
  ROLE_LEVEL: { superadmin: 100, manager: 50, partner: 10 },
}));

const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

// ── fetchCmsProfileByAuthId: id 인자에 따라 다른 프로필을 반환 ──────────────────
const mockFetchCmsProfile = vi.fn();
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => mockFetchCmsProfile(...args),
}));

// ── Supabase admin 클라이언트 스텁 (from/rpc/auth.admin 공용) ───────────────────
type QueryResult = { data: unknown; error: unknown; count?: number };

const mockAuditInsert = vi.fn();

function makeChainable(table: string, tables: Record<string, QueryResult>) {
  const result = tables[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.delete = vi.fn(() => chain);
  chain.insert = vi.fn((payload: unknown) => {
    mockAuditInsert(table, payload);
    return chain;
  });
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeAdminStub(
  opts: { tables?: Record<string, QueryResult>; rpc?: QueryResult } = {}
) {
  const tables = opts.tables ?? {};
  return {
    from: vi.fn((table: string) => makeChainable(table, tables)),
    rpc: vi.fn().mockResolvedValue(opts.rpc ?? { data: null, error: null }),
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        updateUserById: vi.fn().mockResolvedValue({ data: null, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
  };
}

let mockAdminStub = makeAdminStub();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdminStub,
}));

// ── 동적 import (vi.mock 호이스팅 이후에 실행됨) ──────────────────────────────
const { actions: listActions } = await import('../../routes/cms/accounts/list/+page.server');
const { actions: accountActions } = await import('../../routes/cms/accounts/+page.server');
const { PUT: menuPermissionsPut } = await import(
  '../../routes/api/cms/accounts/[id]/menu-permissions/+server'
);

const CALLER_ID = 'caller-uid';
const TARGET_SUPERADMIN_ID = 'target-superadmin-uid';
const TARGET_PARTNER_ID = 'target-partner-uid';

function makeAuthLocals() {
  return {
    safeGetSession: vi
      .fn()
      .mockResolvedValue({ session: { user: { id: CALLER_ID, email: 'caller@test.com' } } }),
  };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

function wireProfiles(map: Record<string, { cms_role: string | null } | null>) {
  mockFetchCmsProfile.mockImplementation(async (_admin: unknown, id: string) => map[id] ?? null);
}

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>;

describe('cms_admin_audit_log — 감사로그 기록', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 2 } } });
  });

  it('role_change: updateRole 성공 시 cms_admin_audit_log에 role_change 이벤트가 기록된다', async () => {
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_PARTNER_ID]: { cms_role: 'partner' },
    });
    const result = await (listActions as ActionMap).updateRole({
      request: makeRequest({ user_id: TARGET_PARTNER_ID, cms_role: 'manager' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
    expect(mockAuditInsert).toHaveBeenCalledWith(
      'cms_admin_audit_log',
      expect.objectContaining({
        user_id: CALLER_ID,
        action_type: 'role_change',
        target_user_id: TARGET_PARTNER_ID,
      })
    );
  });

  it('delete: 삭제 성공 시 cms_admin_audit_log에 delete 이벤트가 기록된다', async () => {
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_PARTNER_ID]: { cms_role: 'partner' },
    });
    const result = await (listActions as ActionMap).delete({
      request: makeRequest({ user_id: TARGET_PARTNER_ID }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
    expect(mockAuditInsert).toHaveBeenCalledWith(
      'cms_admin_audit_log',
      expect.objectContaining({
        user_id: CALLER_ID,
        action_type: 'delete',
        target_user_id: TARGET_PARTNER_ID,
      })
    );
  });

  it('suspend: toggleSuspend 성공 시 cms_admin_audit_log에 suspend 이벤트가 기록된다', async () => {
    wireProfiles({
      [CALLER_ID]: { cms_role: 'manager' },
      [TARGET_PARTNER_ID]: { cms_role: 'partner' },
    });
    const result = await (listActions as ActionMap).toggleSuspend({
      request: makeRequest({ user_id: TARGET_PARTNER_ID, is_suspended: 'false' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
    expect(mockAuditInsert).toHaveBeenCalledWith(
      'cms_admin_audit_log',
      expect.objectContaining({
        user_id: CALLER_ID,
        action_type: 'suspend',
        target_user_id: TARGET_PARTNER_ID,
      })
    );
  });

  it('create: superadmin 신규 계정 생성 성공 시 cms_admin_audit_log에 create 이벤트가 기록된다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('superadmin');
    wireProfiles({ [CALLER_ID]: { cms_role: 'superadmin' } });
    const result = await (accountActions as ActionMap).createAccount({
      request: makeRequest({
        name: '신규 마스터',
        email: 'master2@test.com',
        phone: '01099998888',
        cms_role: 'superadmin',
        cms_allow_concurrent_login: 'false',
        cms_session_timeout_hours: 'false',
      }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
    expect(mockAuditInsert).toHaveBeenCalledWith(
      'cms_admin_audit_log',
      expect.objectContaining({
        user_id: CALLER_ID,
        action_type: 'create',
        target_user_id: 'new-uid',
      })
    );
  });

  it('create: manager/partner 신규 계정 생성 시에는 감사로그를 기록하지 않는다(superadmin 생성 시에만)', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = await (accountActions as ActionMap).createAccount({
      request: makeRequest({
        name: '신규 매니저',
        email: 'manager2@test.com',
        phone: '01099998888',
        cms_role: 'manager',
        cms_allow_concurrent_login: 'false',
        cms_session_timeout_hours: 'false',
      }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it('menu_permission_change: 메뉴권한 저장 성공 시 cms_admin_audit_log에 기록된다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = (await menuPermissionsPut({
      locals: { ...makeAuthLocals() },
      params: { id: TARGET_PARTNER_ID },
      request: { json: async () => ({ menu_key: 'products.list', allowed: false }) },
    } as unknown as Parameters<typeof menuPermissionsPut>[0])) as unknown as {
      status: number;
      data: unknown;
    };
    expect(result.status).toBe(200);
    expect(mockAuditInsert).toHaveBeenCalledWith(
      'cms_admin_audit_log',
      expect.objectContaining({
        user_id: CALLER_ID,
        action_type: 'menu_permission_change',
        target_user_id: TARGET_PARTNER_ID,
      })
    );
  });

  it('concurrent_login_change / session_limit_change / name_change도 각각 기록된다', async () => {
    wireProfiles({
      [CALLER_ID]: { cms_role: 'manager' },
      [TARGET_PARTNER_ID]: { cms_role: 'partner' },
    });

    await (listActions as ActionMap).toggleConcurrent({
      request: makeRequest({ user_id: TARGET_PARTNER_ID, current: 'false' }),
      locals: makeAuthLocals(),
    });
    await (listActions as ActionMap).toggleSession({
      request: makeRequest({ user_id: TARGET_PARTNER_ID, has_limit: 'true' }),
      locals: makeAuthLocals(),
    });
    await (listActions as ActionMap).updateName({
      request: makeRequest({ user_id: TARGET_PARTNER_ID, full_name: '이름변경' }),
      locals: makeAuthLocals(),
    });

    const actionTypes = mockAuditInsert.mock.calls.map((c) => (c[1] as { action_type: string }).action_type);
    expect(actionTypes).toEqual(
      expect.arrayContaining(['concurrent_login_change', 'session_limit_change', 'name_change'])
    );
  });
});

describe('EC-3/EC-4: 마지막 남은 마스터(superadmin) 보호 (Q4 확정)', () => {
  it('EC-3a: superadmin이 1명뿐일 때, 그 계정을 updateRole로 강등하려 하면 403으로 거부한다(호출자가 superadmin이어도)', async () => {
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 1 } } });
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
    });
    const result = await (listActions as ActionMap).updateRole({
      request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, cms_role: 'manager' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 403 });
    expect(mockAdminStub.rpc).not.toHaveBeenCalled();
  });

  it('EC-3b: superadmin이 1명뿐일 때, 그 계정을 delete하려 하면 403으로 거부한다', async () => {
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 1 } } });
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
    });
    const result = await (listActions as ActionMap).delete({
      request: makeRequest({ user_id: TARGET_SUPERADMIN_ID }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 403 });
    expect(mockAdminStub.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('EC-4: superadmin이 2명 이상이면 updateRole 강등이 정상 통과한다', async () => {
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 2 } } });
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
    });
    const result = await (listActions as ActionMap).updateRole({
      request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, cms_role: 'manager' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
  });

  it('EC-4: superadmin이 2명 이상이면 delete가 정상 통과한다', async () => {
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 2 } } });
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
    });
    const result = await (listActions as ActionMap).delete({
      request: makeRequest({ user_id: TARGET_SUPERADMIN_ID }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
  });

  it('대상이 superadmin이 아니면(partner) 마지막마스터 가드가 관여하지 않는다', async () => {
    mockAdminStub = makeAdminStub({ tables: { user_profiles: { data: null, error: null, count: 1 } } });
    wireProfiles({
      [CALLER_ID]: { cms_role: 'superadmin' },
      [TARGET_PARTNER_ID]: { cms_role: 'partner' },
    });
    const result = await (listActions as ActionMap).delete({
      request: makeRequest({ user_id: TARGET_PARTNER_ID }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ success: true });
  });
});
