import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /cms/customers/settings (회원코드 코드조합 기준설정) — saveMemberCodeCombo / bulkReissue
 * 액션의 안전장치(권한 가드 + 명시적 확인 가드 + 선행조건 가드) 회귀 테스트.
 *
 * 배경: 이 화면은 신규가입자 채번 접두어를 바꾸는(saveMemberCodeCombo) + 기존 고객 전원의
 * member_code를 되돌릴 수 없이 일괄 재발급하는(bulkReissue) CRITICAL 액션인데도, RPC 레벨
 * 테스트(memberCodeCombo.test.ts)만 있고 화면 액션 자체(권한 가드·30자 초과 접두어 차단·
 * confirmed 체크박스 강제·기준 코드 미설정 차단)에는 테스트가 전혀 없었다. cmsSecurityGuards
 * .test.ts와 동일한 모킹 패턴으로 액션 함수를 직접 호출해 각 가드를 검증한다.
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

// ── Supabase admin 클라이언트 스텁 — 테스트별로 mockAdminStub을 재구성한다 ─────
// (vi.mock 호이스팅 제약상 참조 변수명은 'mock'으로 시작해야 함)

type QueryResult = { data: unknown; error: unknown };

function makeChainable(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.upsert = vi.fn().mockResolvedValue(result);
  chain.insert = vi.fn().mockResolvedValue(result);
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  // supabase-js 쿼리 빌더는 그 자체로 thenable — 중간에 await해도 동작해야 함
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeAdminStub(opts: { tables?: Record<string, QueryResult>; rpc?: QueryResult } = {}) {
  const tables = opts.tables ?? {};
  return {
    from: vi.fn((table: string) => makeChainable(tables[table] ?? { data: null, error: null })),
    rpc: vi.fn().mockResolvedValue(opts.rpc ?? { data: null, error: null }),
  };
}

let mockAdminStub = makeAdminStub();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdminStub,
}));

// ── 동적 import (vi.mock 호이스팅 이후에 실행됨) ──────────────────────────────
const { actions } = await import('../../routes/cms/customers/settings/+page.server');

// ── 스텁 팩토리 ──────────────────────────────────────────────────────────────

function makeUnauthLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: null }) };
}

function makeAuthLocals() {
  return {
    safeGetSession: vi
      .fn()
      .mockResolvedValue({ session: { user: { id: 'admin-uid', email: 'admin@test.com' } } }),
  };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>;

describe('customers/settings — saveMemberCodeCombo 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminStub = makeAdminStub();
  });

  it('RED → GREEN: cmsRole 없으면 403 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue(null);
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('RED → GREEN: partner 역할이면 403 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it('manager 역할 + combo_row_id 누락 시 400 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
  });

  it('code_mapping_items 조회 결과가 비어있으면 400(유효하지 않은 코드 조합)을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({ tables: { code_mapping_items: { data: [], error: null } } });
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
  });

  it('product_category_codes 조회 결과가 비어있으면 400(분류코드를 찾을 수 없음)을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: {
        code_mapping_items: { data: [{ taxonomy_code_id: 'tc-1' }], error: null },
        product_category_codes: { data: [], error: null },
      },
    });
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
  });

  // 회귀 방지 — migration 276(member_code_sequences.member_type VARCHAR(2)→(30)) 원인이 된
  // 케이스: 접두어가 30자를 넘으면 DB 채번 시점(22001)이 아니라 이 저장 액션에서 미리 막혀야 한다.
  it('회귀 방지: 조합 접두어가 30자를 초과하면 저장을 거부한다(migration 276 재발 방지)', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: {
        code_mapping_items: { data: [{ taxonomy_code_id: 'tc-1' }], error: null },
        product_category_codes: {
          data: [{ id: 'tc-1', code: 'A'.repeat(31), code_tier: 'major', depth: 0 }],
          error: null,
        },
      },
    });
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
  });

  it('유효한 조합(30자 이내) + upsert 성공 시 success:true를 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: {
        code_mapping_items: { data: [{ taxonomy_code_id: 'tc-1' }], error: null },
        product_category_codes: {
          data: [{ id: 'tc-1', code: 'CAM', code_tier: 'major', depth: 0 }],
          error: null,
        },
        cms_settings: { data: null, error: null },
      },
    });
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ action: 'saveMemberCodeCombo', success: true });
  });

  it('upsert 실패 시 500을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: {
        code_mapping_items: { data: [{ taxonomy_code_id: 'tc-1' }], error: null },
        product_category_codes: {
          data: [{ id: 'tc-1', code: 'CAM', code_tier: 'major', depth: 0 }],
          error: null,
        },
        cms_settings: { data: null, error: { message: 'insert failed' } },
      },
    });
    const result = await (actions as ActionMap).saveMemberCodeCombo({
      request: makeRequest({ combo_row_id: 'row-1', group_name: '일반회원' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 500 });
  });
});

describe('customers/settings — bulkReissue 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminStub = makeAdminStub();
  });

  it('세션 없으면 401 반환한다', async () => {
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeUnauthLocals(),
    });
    expect(result).toMatchObject({ status: 401 });
  });

  it('세션은 있으나 cmsRole 없으면 403 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue(null);
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 403 });
  });

  // 되돌릴 수 없는 대량 변경이므로 명시적 확인(confirmed=true) 없이는 절대 진행되면 안 된다.
  it('confirmed=true가 아니면 400을 반환하고 RPC를 호출하지 않는다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({}),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
    expect(mockAdminStub.rpc).not.toHaveBeenCalled();
  });

  it('기준 코드(cms_settings)가 아직 설정되지 않았으면 400을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({ tables: { cms_settings: { data: null, error: null } } });
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
    expect(mockAdminStub.rpc).not.toHaveBeenCalled();
  });

  it('RPC 에러 시 500을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: { cms_settings: { data: { value: { prefix: 'CSBC', group_name: 'g', combo_row_id: 'r' } }, error: null } },
      rpc: { data: null, error: { message: 'rpc failed' } },
    });
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 500 });
  });

  it('RPC가 success:false를 반환하면 400을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: { cms_settings: { data: { value: { prefix: 'CSBC', group_name: 'g', combo_row_id: 'r' } }, error: null } },
      rpc: { data: { success: false, error: '빈 접두어' }, error: null },
    });
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ status: 400 });
  });

  it('정상 흐름: confirmed=true + 기준 코드 설정됨 + RPC 성공 시 reissuedCount를 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    mockAdminStub = makeAdminStub({
      tables: { cms_settings: { data: { value: { prefix: 'CSBC', group_name: 'g', combo_row_id: 'r' } }, error: null } },
      rpc: { data: { success: true, reissued_count: 12 }, error: null },
    });
    const result = await (actions as ActionMap).bulkReissue({
      request: makeRequest({ confirmed: 'true' }),
      locals: makeAuthLocals(),
    });
    expect(result).toMatchObject({ action: 'bulkReissue', success: true, reissuedCount: 12 });
    expect(mockAdminStub.rpc).toHaveBeenCalledWith('bulk_reissue_member_codes', {
      p_prefix: 'CSBC',
      p_reissued_by: 'admin@test.com',
    });
  });
});
