import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /cms/subscriptions 화면 액션 가드 회귀 방지 — CMS 백오피스 전역 정밀검증 v3 STAGE 3에서
 * "구독 관리 화면은 RPC/코드 자체는 견고하나 화면 전용 테스트가 전무하다"는 커버리지 공백이
 * 발견됐다. 구독 혜택이 전사적으로 쿠폰·포인트를 자동발행할 수 있어 manager+ 전용으로
 * 제한된 화면(security-auth.md 접근매트릭스)이므로, 4개 액션(toggleStatus·
 * deleteSubscription·updateSection·retryProductCode) 전부가 partner 역할을 실제로
 * 차단하는지를 최소 회귀 가드로 고정한다.
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
}));

const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
  }),
}));

const { actions } = await import('../../routes/cms/subscriptions/+page.server');

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>;

describe('subscriptions — 액션 권한가드(manager+ 전용)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggleStatus: partner 역할이면 403을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const result = await (actions as ActionMap).toggleStatus({
      request: makeRequest({ id: '1', status: 'active' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('deleteSubscription: partner 역할이면 403을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const result = await (actions as ActionMap).deleteSubscription({
      request: makeRequest({ id: '1' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('updateSection: partner 역할이면 403을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const result = await (actions as ActionMap).updateSection({
      request: makeRequest({ plan_id: '1', section_type: 'basic', name: '테스트' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('retryProductCode: partner 역할이면 403을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const result = await (actions as ActionMap).retryProductCode({
      request: makeRequest({ plan_id: '1', category: 'lens' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('updateSection: manager 역할 + plan_id 누락 시 400을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = await (actions as ActionMap).updateSection({
      request: makeRequest({ section_type: 'basic', name: '테스트' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 400 });
  });

  it('updateSection: manager 역할 + basic 섹션 + name 누락 시 400을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = await (actions as ActionMap).updateSection({
      request: makeRequest({ plan_id: '1', section_type: 'basic' }),
      locals: {},
    });
    expect(result).toMatchObject({ status: 400 });
  });
});
