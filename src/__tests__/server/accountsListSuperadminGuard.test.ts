import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /cms/accounts/list — 마스터(superadmin) 대상 계정 보호 게이트 회귀 테스트
 * (2026-08-25, harness TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 2)
 *
 * 배경(§조사결과 C): `requireSuperadmin()`이라는 이름의 기존 헬퍼는 실제로는
 * `hasSettingsAccess()`(manager 이상, level>=50)만 검사하고 있었고, updateRole/
 * toggleConcurrent/toggleSession/toggleSuspend/delete 5개 액션 어디에도 "조작 대상(target)
 * 계정의 현재 cms_role이 superadmin인지"를 확인하는 로직이 없었다 — manager 등급 관리자가
 * form POST 조작만으로 superadmin(마스터) 계정을 강등·정지·삭제할 수 있는 상태였다.
 *
 * EC-1: manager가 updateRole로 superadmin 대상의 role을 바꾸려 시도 → 403 거부
 * EC-2: manager가 delete/toggleSuspend로 superadmin 대상을 조작 시도 → 403 거부
 * + 회귀 방지: manager가 partner/manager 대상을 관리하는 기존 정상 시나리오는 무회귀
 */

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

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  getRoleLevel: (role: string) =>
    ({ superadmin: 100, manager: 50, partner: 10 })[role] ?? 0,
  ROLE_LEVEL: { superadmin: 100, manager: 50, partner: 10 },
}));

// ── fetchCmsProfileByAuthId: id 인자에 따라 다른 프로필을 반환하도록 스텁 ────────
const mockFetchCmsProfile = vi.fn();
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => mockFetchCmsProfile(...args),
}));

// ── Supabase admin 클라이언트 스텁 ───────────────────────────────────────────
type QueryResult = { data: unknown; error: unknown; count?: number };

function makeChainable(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.delete = vi.fn(() => chain);
  // Stage 7: cms_admin_audit_log INSERT — 감사로그(fire-and-forget) 대응
  chain.insert = vi.fn(() => chain);
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeAdminStub(
  opts: { tables?: Record<string, QueryResult>; rpc?: QueryResult } = {}
) {
  const tables = opts.tables ?? {};
  return {
    from: vi.fn((table: string) => makeChainable(tables[table] ?? { data: null, error: null })),
    rpc: vi.fn().mockResolvedValue(opts.rpc ?? { data: null, error: null }),
    auth: {
      admin: {
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
const { actions } = await import('../../routes/cms/accounts/list/+page.server');

// ── 스텁 팩토리 ──────────────────────────────────────────────────────────────
const CALLER_ID = 'caller-uid';
const TARGET_SUPERADMIN_ID = 'target-superadmin-uid';
const TARGET_PARTNER_ID = 'target-partner-uid';
const TARGET_MANAGER_ID = 'target-manager-uid';

function makeAuthLocals() {
  return {
    safeGetSession: vi
      .fn()
      .mockResolvedValue({ session: { user: { id: CALLER_ID, email: 'caller@test.com' } } }),
  };
}

function makeUnauthLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: null }) };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

// id 인자별로 다른 cms_role을 돌려주는 표준 프로필 맵
function wireProfiles(map: Record<string, { cms_role: string | null } | null>) {
  mockFetchCmsProfile.mockImplementation(async (_admin: unknown, id: string) => map[id] ?? null);
}

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>;

describe('/cms/accounts/list — 대상(target)이 superadmin일 때만 발동하는 게이트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminStub = makeAdminStub();
  });

  describe('EC-1: updateRole — manager 호출자 + superadmin 대상', () => {
    it('RED → GREEN: manager가 superadmin 대상 role을 바꾸려 하면 403을 반환한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).updateRole({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, cms_role: 'manager' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.rpc).not.toHaveBeenCalled();
    });

    it('회귀 방지: manager가 partner 대상 role을 바꾸는 기존 정상 흐름은 그대로 성공한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_PARTNER_ID]: { cms_role: 'partner' },
      });
      mockAdminStub = makeAdminStub({ rpc: { data: null, error: null } });
      const result = await (actions as ActionMap).updateRole({
        request: makeRequest({ user_id: TARGET_PARTNER_ID, cms_role: 'manager' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
      expect(mockAdminStub.rpc).toHaveBeenCalledWith('cms_update_admin_role', {
        p_user_id: TARGET_PARTNER_ID,
        p_cms_role: 'manager',
      });
    });

    it('superadmin 호출자가 superadmin 대상 role을 바꾸면 통과한다(superadmin 2명 이상 — 마지막마스터 아님)', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'superadmin' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      // Stage 7: 마지막마스터 보호 가드(requireNotLastSuperadmin)가 조회하는
      // user_profiles superadmin count — 2명 이상이므로 강등이 차단되지 않아야 한다.
      mockAdminStub = makeAdminStub({
        rpc: { data: null, error: null },
        tables: { user_profiles: { data: null, error: null, count: 2 } },
      });
      const result = await (actions as ActionMap).updateRole({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, cms_role: 'manager' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
    });
  });

  describe('EC-2: delete/toggleSuspend — manager 호출자 + superadmin 대상', () => {
    it('RED → GREEN: manager가 superadmin 대상을 삭제(delete)하려 하면 403을 반환하고 실제 삭제 호출을 하지 않는다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).delete({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('RED → GREEN: manager가 superadmin 대상을 사용중지(toggleSuspend)하려 하면 403을 반환한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).toggleSuspend({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, is_suspended: 'false' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it('회귀 방지: manager가 partner 대상을 삭제하는 기존 정상 흐름은 그대로 성공한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_PARTNER_ID]: { cms_role: 'partner' },
      });
      const result = await (actions as ActionMap).delete({
        request: makeRequest({ user_id: TARGET_PARTNER_ID }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
      expect(mockAdminStub.auth.admin.deleteUser).toHaveBeenCalledWith(TARGET_PARTNER_ID);
    });

    it('회귀 방지: manager가 partner 대상을 사용중지하는 기존 정상 흐름은 그대로 성공한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_PARTNER_ID]: { cms_role: 'partner' },
      });
      const result = await (actions as ActionMap).toggleSuspend({
        request: makeRequest({ user_id: TARGET_PARTNER_ID, is_suspended: 'false' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
    });
  });

  describe('추가 액션(toggleConcurrent/toggleSession)도 동일하게 대상 superadmin 보호가 적용된다', () => {
    it('manager가 superadmin 대상의 중복허용을 토글하려 하면 403을 반환한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).toggleConcurrent({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, current: 'false' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.rpc).not.toHaveBeenCalled();
    });

    it('manager가 superadmin 대상의 세션제한을 토글하려 하면 403을 반환한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).toggleSession({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, has_limit: 'true' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.rpc).not.toHaveBeenCalled();
    });

    it('회귀 방지: manager가 manager 대상의 세션제한을 토글하는 기존 정상 흐름은 그대로 성공한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_MANAGER_ID]: { cms_role: 'manager' },
      });
      mockAdminStub = makeAdminStub({ rpc: { data: null, error: null } });
      const result = await (actions as ActionMap).toggleSession({
        request: makeRequest({ user_id: TARGET_MANAGER_ID, has_limit: 'true' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
    });
  });

  describe('updatePhone — manager 호출자 + superadmin 대상 (Stage 9 QA 블로킹 수정)', () => {
    it('RED → GREEN: manager가 superadmin 대상의 휴대번호를 바꾸려 하면 403을 반환하고 RPC를 호출하지 않는다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      const result = await (actions as ActionMap).updatePhone({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, phone: '01099998888' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
      expect(mockAdminStub.rpc).not.toHaveBeenCalled();
    });

    it('회귀 방지: manager가 partner 대상의 휴대번호를 바꾸는 기존 정상 흐름은 그대로 성공한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'manager' },
        [TARGET_PARTNER_ID]: { cms_role: 'partner' },
      });
      mockAdminStub = makeAdminStub({ rpc: { data: null, error: null } });
      const result = await (actions as ActionMap).updatePhone({
        request: makeRequest({ user_id: TARGET_PARTNER_ID, phone: '01011112222' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
      expect(mockAdminStub.rpc).toHaveBeenCalledWith('cms_update_admin_phone', {
        p_user_id: TARGET_PARTNER_ID,
        p_phone: '01011112222',
      });
    });

    it('superadmin 호출자가 superadmin 대상의 휴대번호를 바꾸면 통과한다', async () => {
      wireProfiles({
        [CALLER_ID]: { cms_role: 'superadmin' },
        [TARGET_SUPERADMIN_ID]: { cms_role: 'superadmin' },
      });
      mockAdminStub = makeAdminStub({ rpc: { data: null, error: null } });
      const result = await (actions as ActionMap).updatePhone({
        request: makeRequest({ user_id: TARGET_SUPERADMIN_ID, phone: '01033334444' }),
        locals: makeAuthLocals(),
      });
      expect(result).toMatchObject({ success: true });
    });
  });

  describe('세션 없음(비인증) — 대상이 superadmin이 아니어도 401이 아니라 requireAccountMutationAccess가 403 처리', () => {
    it('비인증 호출자가 partner 대상 role을 바꾸려 하면 403을 반환한다', async () => {
      wireProfiles({
        [TARGET_PARTNER_ID]: { cms_role: 'partner' },
      });
      const result = await (actions as ActionMap).updateRole({
        request: makeRequest({ user_id: TARGET_PARTNER_ID, cms_role: 'manager' }),
        locals: makeUnauthLocals(),
      });
      expect(result).toMatchObject({ status: 403 });
    });
  });
});
