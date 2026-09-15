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

/**
 * fetchCmsProfileByAuthId 목(mock)을 userId→cms_role 맵으로 설정한다.
 *
 * requireAccountMutationAccess()가 대상(target) 계정뿐 아니라 호출자(ACTOR_ID) 본인의
 * cms_role도 fetchCmsProfileByAuthId로 다시 조회하기 때문에(2026-09-15 CRITICAL 수정 —
 * 대상이 superadmin이면 호출자도 진짜 superadmin이어야 통과), 단일 mockResolvedValue로는
 * 대상과 호출자를 구분할 수 없다. 맵에 없는 userId는 기본값 'partner'(대상 계정 기본 표본)로
 * 취급한다.
 */
function mockProfileRoles(roles: Record<string, string>) {
  mockFetchCmsProfile.mockImplementation(async (_admin: unknown, userId: string) => ({
    cms_role: roles[userId] ?? 'partner',
  }));
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
    // 이 describe 블록의 모든 테스트는 호출자(ACTOR_ID)가 manager, 대상 계정이 partner인
    // 시나리오다 — requireAccountMutationAccess()의 "대상이 superadmin이 아니면 통과" 분기.
    mockProfileRoles({ [ACTOR_ID]: 'manager' });
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

  it('CRITICAL(2026-09-15 발견·수정): manager가 대상이 superadmin인 계정의 메뉴 권한을 ' +
    'OFF(allowed=false)로 바꾸려 해도 403으로 거부되고 RPC를 호출하지 않는다 — 매니저가 ' +
    '마스터 계정의 메뉴 접근을 몰래 차단할 수 있던 공백을 requireAccountMutationAccess로 해소', async () => {
    mockProfileRoles({ [ACTOR_ID]: 'manager', 'target-superadmin-uid': 'superadmin' });
    const result = (await PUT(
      makeEventPUT('manager', 'target-superadmin-uid', { menu_key: 'products.list', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('CRITICAL 회귀 확인: 대상이 superadmin이어도 호출자가 진짜 superadmin이면 정상 저장된다', async () => {
    mockProfileRoles({ [ACTOR_ID]: 'superadmin', 'target-superadmin-uid': 'superadmin' });
    const result = (await PUT(
      makeEventPUT('superadmin', 'target-superadmin-uid', { menu_key: 'products.list', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cms_set_menu_permission', {
      p_target_user_id: 'target-superadmin-uid',
      p_menu_key: 'products.list',
      p_allowed: false,
      p_actor_id: ACTOR_ID,
    });
  });

  it('Q6: partner 대상으로 role상 접근 불가능한 메뉴(settings.admin)에 allowed=true 시도 시 400으로 거부하고 RPC를 호출하지 않는다', async () => {
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'settings.admin', allowed: true })
    )) as unknown as ApiResult;
    expect(result.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('narrowing(allowed=false)은 role 상한선(Q6) 체크 없이 항상 허용된다 — 단, 대상이 ' +
    'superadmin인지 확인하는 조회(2026-09-15 신규 가드)는 narrowing에서도 여전히 일어난다', async () => {
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'settings.admin', allowed: false })
    )) as unknown as ApiResult;
    expect(result.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cms_set_menu_permission', {
      p_target_user_id: 'target-partner-uid',
      p_menu_key: 'settings.admin',
      p_allowed: false,
      p_actor_id: ACTOR_ID,
    });
  });

  it('Q6(QA 정밀검수 결함③ 재발방지): partner 대상으로 customers.membership에 allowed=true 시도 시 ' +
    '400으로 거부한다(cmsMenus.ts requiresSettingsAccess 플래그 누락 회귀 재현용 표본 — ' +
    'customers.list는 2026-09-15 Stephen 지시로 파트너 기본 허용 전환돼 이 표본에서 제외됨)', async () => {
    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'customers.membership', allowed: true })
    )) as unknown as ApiResult;
    expect(result.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('role 허용범위 내 allowed=true는 정상 저장된다(role 상한선을 넘지 않는 경우)', async () => {
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

describe('PUT — 슈퍼마스터 잠금(2026-09-15, Stephen 지시): OFF로 전환한 사람이 슈퍼마스터면 ON 복귀도 슈퍼마스터 전용', () => {
  const SUPERADMIN_ID = 'superadmin-uid';
  const MANAGER_ID = 'other-manager-uid';

  beforeEach(() => {
    vi.clearAllMocks();
    // 대상(target, 'target-partner-uid') 계정은 role 상한선 통과를 위해 partner로 고정 —
    // products.list는 requiresSettingsAccess가 없어 partner도 role상 허용 대상이다(Q6 통과용).
    // 호출자(ACTOR_ID)는 각 테스트가 필요에 맞게 mockProfileRoles로 재설정한다
    // (requireAccountMutationAccess가 대상이 superadmin이 아닐 때 호출자의 cms_role도
    // fetchCmsProfileByAuthId로 조회하므로, 기본값(manager)만 미리 깔아둔다).
    mockProfileRoles({ [ACTOR_ID]: 'manager', [SUPERADMIN_ID]: 'superadmin', [MANAGER_ID]: 'manager' });
  });

  it('슈퍼마스터가 OFF로 잠근 항목을 매니저가 ON으로 되돌리려 하면 403 + 안내 메시지를 반환하고 실제 저장은 하지 않는다', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'cms_get_menu_permissions') {
        return {
          data: [{ menu_key: 'products.list', allowed: false, updated_at: '2026-09-15T00:00:00Z', updated_by: SUPERADMIN_ID }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const result = (await PUT(
      makeEventPUT('manager', 'target-partner-uid', { menu_key: 'products.list', allowed: true })
    )) as unknown as ApiResult;

    expect(result.status).toBe(403);
    expect((result.data as { error?: string }).error).toBe('슈퍼마스터 권한 계정에 문의하세요.');
    expect(mockRpc).not.toHaveBeenCalledWith('cms_set_menu_permission', expect.anything());
  });

  it('슈퍼마스터 본인이 ON으로 되돌리는 것은 허용된다', async () => {
    mockProfileRoles({ [ACTOR_ID]: 'superadmin', [SUPERADMIN_ID]: 'superadmin', [MANAGER_ID]: 'manager' });
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'cms_get_menu_permissions') {
        return {
          data: [{ menu_key: 'products.list', allowed: false, updated_at: '2026-09-15T00:00:00Z', updated_by: SUPERADMIN_ID }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const result = (await PUT(
      makeEventPUT('superadmin', 'target-partner-uid', { menu_key: 'products.list', allowed: true })
    )) as unknown as ApiResult;

    expect(result.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cms_set_menu_permission', {
      p_target_user_id: 'target-partner-uid',
      p_menu_key: 'products.list',
      p_allowed: true,
      p_actor_id: ACTOR_ID,
    });
  });

  it('매니저가 OFF로 끈 항목(잠금 아님)은 다른 매니저가 자유롭게 ON으로 되돌릴 수 있다', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'cms_get_menu_permissions') {
        return {
          data: [{ menu_key: 'products.list', allowed: false, updated_at: '2026-09-15T00:00:00Z', updated_by: MANAGER_ID }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

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
});
