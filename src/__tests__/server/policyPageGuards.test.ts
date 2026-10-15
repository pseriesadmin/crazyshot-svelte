import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * /cms/set/policy '정책관리' 페이지(2026-10-15 신설, 설정 서브메뉴) — 구 /cms/set/rental(대여·예약 이용안내·서비스 기본 정보)과
 * 구 /cms/subscriptions/new(⑤ 정책설정)에서 이관된 10개 액션의 권한·입력 가드 회귀 테스트 +
 * "이전 화면에서 실제로 제거됐는가" 소스 점검.
 *
 * 이관 후에도 manager 이상만 실행 가능해야 하고(세션 없음 401 / 역할 없음·partner 403),
 * 이관 전 입력 검증(글자수·개수 한도·허용 필드)이 그대로 유지돼야 한다.
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

type QueryResult = { data: unknown; error: unknown; count?: number };

function makeChainable(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.insert = vi.fn().mockResolvedValue(result);
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeAdminStub(tables: Record<string, QueryResult> = {}) {
  return {
    from: vi.fn((table: string) => makeChainable(tables[table] ?? { data: null, error: null })),
  };
}

let mockAdminStub = makeAdminStub();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdminStub,
}));

const { actions, load } = await import('../../routes/cms/set/policy/+page.server');

function makeLocals(opts: { session?: boolean; rpcError?: string } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: opts.rpcError ? { message: opts.rpcError } : null });
  return {
    rpc,
    locals: {
      safeGetSession: vi
        .fn()
        .mockResolvedValue({ session: opts.session === false ? null : { user: { id: 'admin-uid' } } }),
      supabase: { rpc },
    },
  };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>;
const A = actions as ActionMap;

const SESSION_CHECKED = ['saveGuide', 'savePolicy', 'saveServiceInfo', 'addConsent', 'deleteConsent', 'reorderConsents'] as const;
const ROLE_ONLY = ['addPolicyItem', 'updatePolicyItem', 'deletePolicyItem', 'reorderPolicyItems'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminStub = makeAdminStub();
});

describe('정책관리 페이지 — 10개 액션이 등록돼 있다', () => {
  it.each([...SESSION_CHECKED, ...ROLE_ONLY])('%s 액션 존재', (name) => {
    expect(typeof A[name]).toBe('function');
  });
});

type LoadFn = (e: unknown) => Promise<Record<string, unknown>>;

describe('정책관리 페이지 — 진입(load) 게이트', () => {
  const run = (session: boolean, role: string | null) =>
    (load as unknown as LoadFn)({
      locals: { safeGetSession: vi.fn().mockResolvedValue({ session: session ? { user: { id: 'u1' } } : null }) },
      parent: async () => ({ cmsRole: role }),
    });

  it('세션이 없으면 /cms/login으로 보낸다', async () => {
    await expect(run(false, null)).rejects.toMatchObject({ status: 303, location: '/cms/login' });
  });

  it.each([[null], ['partner']])('cmsRole=%s이면 접근 거부 안내와 함께 /cms로 보낸다', async (role) => {
    await expect(run(true, role)).rejects.toMatchObject({ status: 303, location: '/cms?notice=access_denied' });
  });

  it.each([['manager'], ['superadmin']])('%s는 통과하고 화면 데이터 5종을 반환한다', async (role) => {
    const data = await run(true, role);
    expect(Object.keys(data).sort()).toEqual(['consents', 'guideText', 'policyItems', 'policySettings', 'serviceInfo']);
    expect(data.guideText).toBe('');
    expect(data.consents).toEqual([]);
    expect(data.policySettings).toEqual({ privacy_text: '', terms_text: '', refund_text: '' });
  });
});

describe('정책관리 페이지 — 권한 가드', () => {
  it.each(SESSION_CHECKED)('%s: 세션이 없으면 401', async (name) => {
    const { locals } = makeLocals({ session: false });
    const result = await A[name]({ request: makeRequest({}), locals });
    expect(result).toMatchObject({ status: 401 });
  });

  it.each([...SESSION_CHECKED, ...ROLE_ONLY])('%s: cmsRole이 없으면 403', async (name) => {
    mockGetCmsRoleForAction.mockResolvedValue(null);
    const { locals, rpc } = makeLocals();
    const result = await A[name]({ request: makeRequest({ id: 'x', content: 'x' }), locals });
    expect(result).toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([...SESSION_CHECKED, ...ROLE_ONLY])('%s: partner면 403(manager 이상만 실행 가능)', async (name) => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const { locals, rpc } = makeLocals();
    const result = await A[name]({ request: makeRequest({ id: 'x', content: 'x' }), locals });
    expect(result).toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('정책관리 페이지 — 이용안내·법적 고지·동의문 입력 가드', () => {
  beforeEach(() => mockGetCmsRoleForAction.mockResolvedValue('manager'));

  it('saveGuide: 1,000자 초과면 400이고 RPC를 호출하지 않는다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.saveGuide({ request: makeRequest({ guide_text: 'a'.repeat(1001) }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saveGuide: 정상 입력이면 upsert_rental_guide를 호출하고 success를 반환한다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.saveGuide({ request: makeRequest({ guide_text: '안내문' }), locals });
    expect(rpc).toHaveBeenCalledWith('upsert_rental_guide', { p_guide_text: '안내문' });
    expect(result).toMatchObject({ action: 'saveGuide', success: true });
  });

  it('savePolicy: 허용되지 않은 항목명이면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.savePolicy({ request: makeRequest({ policy_field: 'evil_text', policy_text: 'x' }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('savePolicy: 5,000자 초과면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.savePolicy({ request: makeRequest({ policy_field: 'terms_text', policy_text: 'a'.repeat(5001) }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['privacy_text', 'p_privacy'],
    ['terms_text', 'p_terms'],
    ['refund_text', 'p_refund'],
  ])('savePolicy: %s는 %s 파라미터로 저장된다', async (field, param) => {
    const { locals, rpc } = makeLocals();
    const result = await A.savePolicy({ request: makeRequest({ policy_field: field, policy_text: '내용' }), locals });
    expect(rpc).toHaveBeenCalledWith('upsert_rental_policy_settings', { [param]: '내용' });
    expect(result).toMatchObject({ action: 'savePolicy', success: true });
  });

  it('saveServiceInfo: 한 항목이라도 200자를 넘으면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.saveServiceInfo({ request: makeRequest({ company_name: 'a'.repeat(201) }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saveServiceInfo: 정상 입력이면 9개 파라미터로 upsert_service_info_settings를 호출한다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.saveServiceInfo({ request: makeRequest({ company_name: ' (주)크레이지샷 ', cs_phone: '1588-0033' }), locals });
    expect(rpc).toHaveBeenCalledWith(
      'upsert_service_info_settings',
      expect.objectContaining({ p_company_name: '(주)크레이지샷', p_cs_phone: '1588-0033', p_ceo_name: '' }),
    );
    expect(result).toMatchObject({ action: 'saveServiceInfo', success: true });
  });

  it('addConsent: 내용이 비면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.addConsent({ request: makeRequest({ content: '  ', count: '0' }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('addConsent: 이미 10개면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.addConsent({ request: makeRequest({ content: '동의', count: '10' }), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('addConsent: 정상 입력이면 display_order=count로 저장한다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.addConsent({ request: makeRequest({ content: '동의', count: '3' }), locals });
    expect(rpc).toHaveBeenCalledWith('upsert_rental_consent_item', { p_id: null, p_content: '동의', p_display_order: 3 });
    expect(result).toMatchObject({ action: 'addConsent', success: true });
  });

  it('reorderConsents: ids가 없으면 400이다', async () => {
    const { locals, rpc } = makeLocals();
    const result = await A.reorderConsents({ request: makeRequest({}), locals });
    expect(result).toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('RPC 오류는 500으로 전달한다', async () => {
    const { locals } = makeLocals({ rpcError: 'db down' });
    const result = await A.deleteConsent({ request: makeRequest({ id: 'c1' }), locals });
    expect(result).toMatchObject({ status: 500 });
  });
});

describe('정책관리 페이지 — 정기구독 정책항목 입력 가드', () => {
  beforeEach(() => mockGetCmsRoleForAction.mockResolvedValue('manager'));

  it('addPolicyItem: 빈 내용이면 400이다', async () => {
    const { locals } = makeLocals();
    const result = await A.addPolicyItem({ request: makeRequest({ content: '   ' }), locals });
    expect(result).toMatchObject({ status: 400 });
  });

  it('addPolicyItem: 200자를 넘으면 400이다', async () => {
    const { locals } = makeLocals();
    const result = await A.addPolicyItem({ request: makeRequest({ content: 'a'.repeat(201) }), locals });
    expect(result).toMatchObject({ status: 400 });
  });

  it('addPolicyItem: 이미 20개면 400이고 insert를 하지 않는다', async () => {
    mockAdminStub = makeAdminStub({ subscription_policy_items: { data: [{ sort_order: 19 }], error: null, count: 20 } });
    const { locals } = makeLocals();
    const result = await A.addPolicyItem({ request: makeRequest({ content: '정책' }), locals });
    expect(result).toMatchObject({ status: 400 });
  });

  it('addPolicyItem: 정상 입력이면 success다', async () => {
    mockAdminStub = makeAdminStub({ subscription_policy_items: { data: [{ sort_order: 2 }], error: null, count: 3 } });
    const { locals } = makeLocals();
    const result = await A.addPolicyItem({ request: makeRequest({ content: '정책' }), locals });
    expect(result).toMatchObject({ action: 'addPolicyItem', success: true });
  });

  it('updatePolicyItem: id가 없으면 400이다', async () => {
    const { locals } = makeLocals();
    const result = await A.updatePolicyItem({ request: makeRequest({ content: '내용' }), locals });
    expect(result).toMatchObject({ status: 400 });
  });

  it('deletePolicyItem: id가 없으면 400이다', async () => {
    const { locals } = makeLocals();
    const result = await A.deletePolicyItem({ request: makeRequest({}), locals });
    expect(result).toMatchObject({ status: 400 });
  });

  it('reorderPolicyItems: 깨진 JSON·빈 배열이면 400이다', async () => {
    const { locals } = makeLocals();
    const broken = await A.reorderPolicyItems({ request: makeRequest({ ordered_ids: '{not json' }), locals });
    const empty = await A.reorderPolicyItems({ request: makeRequest({ ordered_ids: '[]' }), locals });
    expect(broken).toMatchObject({ status: 400 });
    expect(empty).toMatchObject({ status: 400 });
  });

  it('reorderPolicyItems: 정상 목록이면 success다', async () => {
    const { locals } = makeLocals();
    const result = await A.reorderPolicyItems({ request: makeRequest({ ordered_ids: JSON.stringify(['a', 'b']) }), locals });
    expect(result).toMatchObject({ action: 'reorderPolicyItems', success: true });
  });
});

describe('이전 화면에서 이관 대상이 실제로 제거됐다(소스 점검)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

  it('/cms/set/rental 서버에는 이관된 6개 액션이 없다', () => {
    const src = read('routes/cms/set/rental/+page.server.ts');
    for (const name of SESSION_CHECKED) expect(src).not.toMatch(new RegExp(`\\b${name}:\\s*async`));
  });

  it('/cms/set/rental 화면에는 이관된 영역이 없다', () => {
    const src = read('routes/cms/set/rental/+page.svelte');
    for (const needle of ['대여·예약 이용안내', '서비스 기본 정보', '?/saveGuide', '?/savePolicy', '?/saveServiceInfo', '?/addConsent', '?/deleteConsent']) {
      expect(src).not.toContain(needle);
    }
  });

  it('/cms/subscriptions/new에는 정책설정(UI·액션·로드)이 없다', () => {
    const page = read('routes/cms/subscriptions/new/+page.svelte');
    const server = read('routes/cms/subscriptions/new/+page.server.ts');
    expect(page).not.toContain('정책설정');
    expect(page).not.toMatch(/PolicyItem|policyItems/);
    expect(server).not.toMatch(/PolicyItem|policyItems|subscription_policy_items/);
  });

  it('/cms/codes에는 정책관리 탭·액션이 남아있지 않다(설정 서브메뉴로 분리)', () => {
    const page = read('routes/cms/codes/+page.svelte');
    const server = read('routes/cms/codes/+page.server.ts');
    expect(page).not.toContain('정책관리');
    expect(page).not.toContain('PolicyTab');
    for (const name of [...SESSION_CHECKED, ...ROLE_ONLY]) expect(server).not.toMatch(new RegExp(`\\b${name}:\\s*async`));
  });

  it('/cms/set/policy 화면에 3개 영역이 있다', () => {
    const page = read('routes/cms/set/policy/+page.svelte');
    for (const title of ['대여·예약 이용안내', '정기구독 이용안내', '서비스 기본 정보']) expect(page).toContain(title);
    expect(page).not.toContain('section-desc');
  });
});
