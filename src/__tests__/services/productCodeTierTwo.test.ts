import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-3 RED — generate_product_code 6-param 오버로드 호출 검증
 *             + TDD-5 RED — generate_inventory_product_code 2단 모드 검증
 *
 * 대상: src/routes/cms/products/new/+page.server.ts
 *
 * TDD-3 검증 포인트:
 *   combo 아이템에 parent_max_sequence가 설정돼 있을 때,
 *   create action이 generate_product_code를 6-param 버전
 *   (p_parent_max_sequence 포함)으로 호출해야 한다.
 *   현재 코드는 parent_max_sequence를 조회하지도, 전달하지도 않으므로 실패(RED).
 *
 * TDD-5 검증 포인트:
 *   2단 모드 부모의 자식 채번(generate_inventory_product_code)이 호출되면
 *   DB에서 product_child_sequences_by_parent를 기준으로 0부터 순번을 채번한다.
 *   (SQL RPC 내부 동작은 stage 검증으로 확인 — TypeScript 측에서는 RPC 호출 자체 검증)
 */

// ── 모듈 모킹 ─────────────────────────────────────────────────────────────────
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

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

// ── 스텁 팩토리 ───────────────────────────────────────────────────────────────
/**
 * 2단 모드 테스트용 스텁:
 *   - combo_row_id 있음
 *   - code_mapping_items에 parent_max_sequence 포함 아이템 반환
 *   - product_category_codes depth 조회 포함
 */
function makeTierTwoAdminStub(options: {
  parentMaxSequence?: number | null;
  maxSequence?: number | null;
} = {}) {
  const rpcCalls: RpcCall[] = [];
  const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params });
    return Promise.resolve({ data: null, error: null });
  });

  const fromFn = vi.fn();

  // 1회차: slug 중복 체크
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  // 2회차: products INSERT
  fromFn.mockReturnValueOnce({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'test-product-id' },
          error: null,
        }),
      }),
    }),
  });

  // 3회차: QR payload UPDATE
  fromFn.mockReturnValueOnce({
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });

  // 4회차: code_mapping_items SELECT (combo 아이템 조회 — parent_max_sequence 포함)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            taxonomy_code_id: 'code-id-1',
            date_option: 'ym',
            max_sequence: options.maxSequence ?? 999,
            parent_max_sequence: options.parentMaxSequence ?? null,
          },
          {
            taxonomy_code_id: 'code-id-2',
            date_option: 'ym',
            max_sequence: options.maxSequence ?? 999,
            parent_max_sequence: options.parentMaxSequence ?? null,
          },
        ],
        error: null,
      }),
    }),
  });

  // 5회차: product_category_codes 전체 조회
  // 버그 수정(2026-08-12): 구버전은 depth 역순 limit(1)으로 단일 코드만 반환했으나
  // 수정 후는 모든 코드를 한 번에 반환해 buildComboCategoryCode()로 합산함
  // 버그 수정(2026-08-13): load()(활성/미삭제 필터)와 미리보기가 어긋나던 비대칭 수정으로
  // .in() 뒤에 .eq('is_active', true).is('deleted_at', null) 체이닝이 추가됨 — mock도 동일하게 반영
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({
            data: [
              { id: 'code-id-1', code: 'CAM', code_tier: 'major', depth: 0 },
              { id: 'code-id-2', code: 'SLR', code_tier: 'minor', depth: 2 },
            ],
            error: null,
          }),
        }),
      }),
    }),
  });

  // 이후 호출(price_rules insert 등) — 성공 기본값
  fromFn.mockReturnValue({
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  return { from: fromFn, rpc: rpcFn, _rpcCalls: rpcCalls };
}

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  };
}

function makeTierTwoRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('name', 'Tier Two Product');
  fd.append('slug', 'tier-two-product');
  fd.append('category', 'camera');
  fd.append('is_active', 'true');
  fd.append('sale_only', 'false');
  fd.append('price_24h', '50000');
  fd.append('combo_row_id', 'combo-row-id-1');  // combo 선택 — 2단 모드 경로 진입
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return { formData: async () => fd } as Request;
}

async function callCreate(request: Request, admin: ReturnType<typeof makeTierTwoAdminStub>) {
  createClientMock.mockReturnValue(admin);
  try {
    const result = await actions.create({
      request,
      locals: makeLocals(),
    } as Parameters<typeof actions.create>[0]);
    return { result, redirectLocation: null };
  } catch (e: unknown) {
    const r = e as { location?: string; status?: number };
    if (r.location) return { result: null, redirectLocation: r.location };
    throw e;
  }
}

beforeEach(() => {
  createClientMock.mockReset();
});

// ── TDD-3 GREEN 테스트 (2026-08-12 수정: 6-param → 7-param 통일)
// 버그 수정으로 모든 콤보 경로가 7-param(p_category_code_override 포함)으로 통일됨
describe('TDD-3 GREEN — 2단 모드: 7-param generate_product_code 호출 검증', () => {
  it('[GREEN] parent_max_sequence가 설정된 combo → 7-param에 p_parent_max_sequence 및 p_category_code_override 포함', async () => {
    const admin = makeTierTwoAdminStub({ parentMaxSequence: 99, maxSequence: 999 });
    const { redirectLocation } = await callCreate(makeTierTwoRequest(), admin);

    // redirect는 성공
    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toContain('/cms/products');

    // generate_product_code 호출 확인
    const codeRpcCall = admin._rpcCalls.find(c => c.name === 'generate_product_code');
    expect(codeRpcCall).toBeDefined();

    // 7-param 검증: p_parent_max_sequence + p_category_code_override 모두 포함
    expect(codeRpcCall?.params).toHaveProperty('p_parent_max_sequence', 99);
    expect(codeRpcCall?.params).toHaveProperty('p_category_code_override', 'CAMSLR');
    expect(codeRpcCall?.params).toHaveProperty('p_max_sequence', 999);
  });

  it('[GREEN] parent_max_sequence가 NULL인 combo도 7-param 호출 (p_parent_max_sequence = null, p_category_code_override 포함)', async () => {
    const admin = makeTierTwoAdminStub({ parentMaxSequence: null, maxSequence: 999 });
    const { redirectLocation } = await callCreate(makeTierTwoRequest(), admin);

    expect(redirectLocation).not.toBeNull();

    const codeRpcCall = admin._rpcCalls.find(c => c.name === 'generate_product_code');
    expect(codeRpcCall).toBeDefined();

    // 수정(2026-08-12): 7-param 통일로 p_parent_max_sequence는 항상 전달 (값은 null)
    // + p_category_code_override도 반드시 포함 (분류코드 합산)
    expect(codeRpcCall?.params).toHaveProperty('p_parent_max_sequence', null);
    expect(codeRpcCall?.params).toHaveProperty('p_category_code_override', 'CAMSLR');
  });
});

// ── TDD-8 회귀 방지 — 기존 1개-순번 모드 무변경 ─────────────────────────────
describe('TDD-8 회귀 — combo_row_id 없을 때 기존 2/3-param RPC 유지', () => {
  it('combo_row_id 없으면 3-param RPC 또는 2-param RPC 호출 (parent_max_sequence 관련 파라미터 없음)', async () => {
    // combo 없는 단순 상품 등록용 스텁
    const rpcCalls: RpcCall[] = [];
    const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    });
    const fromFn = vi.fn();
    fromFn.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }),
    });
    fromFn.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'prod-id' }, error: null }) }) }),
    });
    fromFn.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    });
    fromFn.mockReturnValue({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) });
    createClientMock.mockReturnValue({ from: fromFn, rpc: rpcFn });

    const fd = new FormData();
    fd.append('name', 'Simple Product'); fd.append('slug', 'simple-product');
    fd.append('category', 'camera'); fd.append('is_active', 'true');
    fd.append('sale_only', 'false'); fd.append('price_24h', '50000');
    // combo_row_id 없음

    try {
      await actions.create({ request: { formData: async () => fd } as Request, locals: makeLocals() } as Parameters<typeof actions.create>[0]);
    } catch {/* redirect — 무시 */}

    const codeCall = rpcCalls.find(c => c.name === 'generate_product_code');
    expect(codeCall).toBeDefined();
    // 회귀: 2단 관련 파라미터 없음
    expect(codeCall?.params).not.toHaveProperty('p_parent_max_sequence');
  });
});
