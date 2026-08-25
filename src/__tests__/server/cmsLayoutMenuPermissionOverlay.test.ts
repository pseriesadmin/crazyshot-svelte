import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * src/routes/cms/+layout.server.ts — Stage 3 메뉴권한 오버레이 통합 테스트
 * (2026-08-26, harness TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 3, 3번째 태스크)
 *
 * Q6 확정(좁히기 전용): role이 이미 허용한 경로라도, 그 계정에 대한 메뉴권한 오버라이드가
 * 명시적 차단(allowed=false)이면 추가로 거부한다. role이 애초에 막은 경로를 메뉴권한으로
 * 열어주는 것은 불가능하다.
 *
 * 완료기준: 기존 role 전용 라우트 가드(hasRouteAccess) 무회귀 + 메뉴권한 차단 시나리오 GREEN.
 */

vi.mock('@sveltejs/kit', () => ({
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

const mockFetchCmsProfile = vi.fn();
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => mockFetchCmsProfile(...args),
}));

// 실제 cmsPermissions/cmsMenus 모듈을 그대로 사용한다(Stage 1에서 이미 GREEN 검증된 순수함수) —
// 여기서는 그 둘이 +layout.server.ts에 올바르게 배선됐는지만 검증한다.

let mockOverridesData: { menu_key: string; allowed: boolean }[] | null = [];
let mockOverridesError: { message: string } | null = null;
const mockEq = vi.fn(() => Promise.resolve({ data: mockOverridesData, error: mockOverridesError }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: mockSelect }) }),
}));

const { load } = await import('../../routes/cms/+layout.server');

const USER_ID = 'cms-user-uid';

function makeEvent(opts: {
  pathname: string;
  role: string;
  hasSession?: boolean;
}) {
  mockFetchCmsProfile.mockResolvedValue(opts.role ? { cms_role: opts.role } : null);
  return {
    locals: {
      safeGetSession: vi.fn().mockResolvedValue(
        opts.hasSession === false ? { session: null } : { session: { user: { id: USER_ID } } }
      ),
      supabase: {},
    },
    url: new URL(`https://test.local${opts.pathname}`),
    cookies: {
      getAll: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue('1'), // cms-remember 쿠키 존재로 통과
    },
  } as unknown as Parameters<typeof load>[0];
}

describe('CMS +layout.server.ts — 메뉴권한 오버레이(Stage 3, Q6 좁히기 전용)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOverridesData = [];
    mockOverridesError = null;
  });

  it('회귀 없음: 오버라이드가 없으면 기존 role 기준 통과 그대로 동작한다', async () => {
    mockOverridesData = [];
    const result = await load(makeEvent({ pathname: '/cms/products', role: 'partner' }));
    expect(result).toMatchObject({ cmsRole: 'partner' });
  });

  it('회귀 없음: role 자체가 막은 경로(/cms/accounts, partner)는 기존과 동일하게 즉시 거부된다', async () => {
    await expect(
      load(makeEvent({ pathname: '/cms/accounts', role: 'partner' }))
    ).rejects.toMatchObject({ status: 303, location: '/cms?notice=access_denied' });
    // role 게이트에서 이미 막혔으므로 메뉴권한 오버라이드 조회 자체를 하지 않는다
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('Q6: role상 허용된 경로라도 명시적 차단(allowed=false) 오버라이드가 있으면 거부한다', async () => {
    mockOverridesData = [{ menu_key: 'products.list', allowed: false }];
    await expect(
      load(makeEvent({ pathname: '/cms/products', role: 'manager' }))
    ).rejects.toMatchObject({ status: 303, location: '/cms?notice=access_denied' });
  });

  it('CMS_MENUS에 등록되지 않은 경로는 메뉴권한 오버라이드 조회를 건너뛰고 role 결과만 따른다', async () => {
    mockOverridesData = [{ menu_key: 'dashboard', allowed: false }]; // 무관한 오버라이드
    const result = await load(makeEvent({ pathname: '/cms/mobile', role: 'partner' }));
    expect(result).toMatchObject({ cmsRole: 'partner' });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('메뉴권한 조회 실패(DB 에러) 시 방어적으로 오버라이드 없음 취급 — CMS 로그인이 막히지 않는다', async () => {
    mockOverridesData = null;
    mockOverridesError = { message: 'db down' };
    const result = await load(makeEvent({ pathname: '/cms/products', role: 'manager' }));
    expect(result).toMatchObject({ cmsRole: 'manager' });
  });
});
