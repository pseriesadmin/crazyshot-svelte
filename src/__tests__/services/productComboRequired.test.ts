import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 버그 수정(2026-08-13) — 콤보가 있는 그룹인데 콤보를 선택하지 않고 상품을 등록하면
 * 서버가 조용히 2-param 카테고리 자동 폴백(UPPER(LEFT(category,3)))으로 빠져
 * 코드설정에 없는 임의 품번("HYP" 등)이 발급되던 문제 방지.
 *
 * 대상: src/routes/cms/products/new/+page.server.ts create 액션
 * 검증: group_id는 있는데 combo_row_id가 없고, 그 그룹에 code_mapping_items(콤보)가
 *   1개 이상 존재하면 fail(400)으로 등록 자체를 차단해야 한다.
 */

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test-project.supabase.co',
}));

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { actions } = await import('../../routes/cms/products/new/+page.server');

function makeGuardAdminStub(comboCount: number) {
  const fromFn = vi.fn();

  // 1회차: category 비어있음 + group_id 있음 → code_mapping_groups.default_category 조회
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { default_category: 'hypepack' }, error: null }),
      }),
    }),
  });

  // 2회차: slug 중복 체크 → 미존재
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  // 3회차: 콤보 존재 여부 확인 (code_mapping_items count)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ count: comboCount, error: null }),
    }),
  });

  return { from: fromFn, rpc: vi.fn() };
}

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  };
}

function makeRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('name', 'Guard Test Product');
  fd.append('slug', 'guard-test-product');
  fd.append('group_id', 'group-with-combos-id');
  fd.append('is_active', 'true');
  fd.append('sale_only', 'false');
  fd.append('price_24h', '50000');
  // combo_row_id 의도적으로 미포함
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return { formData: async () => fd } as Request;
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe('콤보 선택 강제 가드 — group_id 있음 + combo_row_id 없음', () => {
  it('[GREEN] 그룹에 콤보가 1개 이상 존재하면 등록을 차단한다(fail 400)', async () => {
    const admin = makeGuardAdminStub(3);
    createClientMock.mockReturnValue(admin);

    const result = await actions.create({
      request: makeRequest(),
      locals: makeLocals(),
    } as Parameters<typeof actions.create>[0]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: '이 분류에는 선택 가능한 조합코드가 있습니다. 조합코드를 먼저 선택해주세요.' },
    });
  });
});
