import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/cms/accounts/[id]/menu-permissions — 메뉴별 세부 접근권한 CRUD API 테스트
 * (2026-08-26, harness TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 3)
 *
 * 배경: Stage 1이 만든 cms_menu_permissions 테이블·hasMenuAccess() 순수 판정함수에는
 * 아직 CRUD API/RPC가 없다. 이 API가 그 저장·집행 계층이다.
 *
 * EC-5: manager 등급 관리자가 메뉴권한 API를 직접 호출해 "자기 자신"에게 권한을 부여/변경하는
 *       self-service 경로 차단.
 * Q6 신규: partner 대상으로 role상 roleAllowsMenuByDefault()(hasRouteAccess/hasSettingsAccess
 *       조합)가 false인 메뉴에 allowed=true를 넣으려는 요청은 서버가 거부한다 —
 *       "메뉴권한이 role 허용범위를 절대 넘어설 수 없다"는 불변조건.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

// cmsMenus.ts(실제 모듈, 언마운트)가 내부적으로 참조하는 leaf 의존성만 통제한다.
// CMS_MENUS 실제 목록의 'products.list'(requiresSettingsAccess 없음)와
// 'settings.admin'(requiresSettingsAccess:true) 조합으로 role 상한선 케이스를 재현한다.
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  hasRouteAccess: (role: string, path: string) =>
    path.startsWith('/cms/accounts') ? ['superadmin', 'manager'].includes(role) : true,
  getRoleLevel: (role: string) =>
    ({ superadmin: 100, manager: 50, partner: 10 } as Record<string, number>)[role] ?? 0,
  ROLE_LEVEL: { superadmin: 100, manager: 50, partner: 10 },
}));

const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

const mockFetchCmsProfile = vi.fn();
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => mockFetchCmsProfile(...args),
}));

const mockRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

// ── 동적 import (vi.mock 호이스팅 이후에 실행됨) ──────────────────────────────
const { GET, PUT } = await import('../../routes/api/cms/accounts/[id]/menu-permissions/+server');

const ACTOR_ID = 'actor-uid';

type ApiResult = { status: number; data: unknown };

function makeLocals(role: string | null) {
  mockGetCmsRoleForAction.mockResolvedValue(role);
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: ACTOR_ID } } }),
  };
}

function makeEventGET(role: string | null, targetId: string) {
  return { locals: makeLocals(role), params: { id: targetId } } as unknown as Parameters<typeof GET>[0];
}

function makePutRequest(body: Record<string, unknown>): Request {
  return { json: async () => body } as unknown as Request;
}

function makeEventPUT(role: string | null, targetId: string, body: Record<string, unknown>) {
  return {
    locals: makeLocals(role),
    params: { id: targetId },
    request: makePutRequest(body),
  } as unknown as Parameters<typeof PUT>[0];
}

describe('GET /api/cms/accounts/[id]/menu-permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('비인증(cmsRole 없음) 호출자는 401을 반환한다', async () => {
    const result = (await GET(makeEventGET(null, 'target-1'))) as unknown as ApiResult;
    expect(result.status).toBe(401);
  });

  it('partner 역할은 403(권한 없음)을 반환한다', async () => {
    const result = (await GET(makeEventGET('partner', 'target-1'))) as unknown as ApiResult;
    expect(result.status).toBe(403);
  });

  it('manager 역할은 cms_get_menu_permissions RPC를 target user_id로 호출해 결과를 반환한다', async () => {
    mockRpc.mockResolvedValue({
      data: [{ menu_key: 'settings.admin', allowed: false, updated_at: '2026-08-26T00:00:00Z', updated_by: ACTOR_ID }],
      error: null,
    });
    const result = (await GET(makeEventGET('manager', 'target-1'))) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cms_get_menu_permissions', { p_user_id: 'target-1' });
    expect(result.data).toEqual([
      { menu_key: 'settings.admin', allowed: false, updated_at: '2026-08-26T00:00:00Z', updated_by: ACTOR_ID },
    ]);
  });

  it('RPC가 null을 반환해도 빈 배열로 정규화한다', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = (await GET(makeEventGET('manager', 'target-1'))) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(result.data).toEqual([]);
  });
});

describe('PUT /api/cms/accounts/[id]/menu-permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockFetchCmsProfile.mockResolvedValue({ cms_role: 'partner' });
  });

  it('partner 역할 호출자는 403(권한 없음)을 반환한다', async () => {
    const result = (await PUT(
      makeEventPUT('partner', 'target-1', { menu_key: 'products.list', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('EC-5: 자기 자신을 대상으로 하면 403을 반환하고 RPC를 호출하지 않는다', async () => {
    const result = (await PUT(
      makeEventPUT('manager', ACTOR_ID, { menu_key: 'products.list', allowed: true })
    )) as unknown as ApiResult;
    expect(result.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Q6: partner 대상으로 role상 접근 불가능한 메뉴(settings.admin)에 allowed=true 시도 시 400으로 거부하고 RPC를 호출하지 않는다', async () => {
    mockFetchCmsProfile.mockResolvedValue({ cms_role: 'partner' });
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'settings.admin', allowed: true })
    )) as unknown as ApiResult;
    expect(result.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('narrowing(allowed=false)은 role과 무관하게 항상 허용된다(role 상한선 체크를 거치지 않음)', async () => {
    mockFetchCmsProfile.mockResolvedValue({ cms_role: 'partner' });
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'settings.admin', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(mockFetchCmsProfile).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('cms_set_menu_permission', {
      p_target_user_id: 'target-partner-uid',
      p_menu_key: 'settings.admin',
      p_allowed: false,
      p_actor_id: ACTOR_ID,
    });
  });

  it('role 허용범위 내 allowed=true는 정상 저장된다(role 상한선을 넘지 않는 경우)', async () => {
    mockFetchCmsProfile.mockResolvedValue({ cms_role: 'partner' });
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'products.list', allowed: true })
    )) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cms_set_menu_permission', {
      p_target_user_id: 'target-partner-uid',
      p_menu_key: 'products.list',
      p_allowed: true,
      p_actor_id: ACTOR_ID,
    });
  });

  it('존재하지 않는 menu_key는 400을 반환한다', async () => {
    const result = (await PUT(
      makeEventPUT('manager', 'target-1', { menu_key: 'not.a.real.menu', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('allowed가 boolean이 아니면 400을 반환한다', async () => {
    const result = (await PUT(
      makeEventPUT('manager', 'target-1', { menu_key: 'products.list', allowed: 'true' })
    )) as unknown as ApiResult;
    expect(result.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('RPC 에러 시 500을 반환한다', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db error' } });
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'products.list', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(500);
  });
});
