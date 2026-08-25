import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-PROD-2/3 — cloneProduct 액션 결함 수정 (TDD RED → GREEN)
 *
 * 대상: src/routes/cms/products/+page.server.ts — cloneProduct 액션
 *
 * 결함 (TDD-PROD-2, add_inventory 모드):
 *   - line 849: is_active: false 하드코딩 → true로 수정 필요 (재고 즉시 대여가능 정책)
 *   - line 861: generate_inventory_product_code RPC 에러 체크 없음
 *
 * 결함 (TDD-PROD-3, new_product 모드):
 *   - line 989/995: generate_product_code RPC 에러 체크 없음 (autoCode 경로)
 *
 * 정책 근거: products.md §3 "신규 자식 기본값: is_active = true (즉시 대여 가능)"
 *
 * from() 호출 시퀀스:
 *   add_inventory (count=1, sourcePriceRulesInv=[]):
 *     1. from('products') — source lookup (select.eq.is.single)
 *     2. from('price_rules') — source price rules (select.eq.eq.is → [])
 *     3. from('products') — slug uniqueness check (select.eq.is.maybeSingle → null, RTN-3)
 *     4. from('products') — INSERT (insert.select.single)
 *
 *   new_product (count=1, sourcePriceRules=[], autoCode=true):
 *     1. from('products') — source lookup (select.eq.is.single)
 *     2. from('price_rules') — source price rules (select.eq.eq.is → [])
 *     3. from('products') — slug check (select.eq.is.maybeSingle)
 *     4. from('products') — INSERT (insert.select.single)
 */

// ── 모듈 모킹 ────────────────────────────────────────────────────────────────
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

const { actions } = await import('../../routes/cms/products/+page.server');

// ── 소스 상품 데이터 ─────────────────────────────────────────────────────────
const SOURCE_PRODUCT = {
  id: 'parent-product-id',
  category: 'camera',
  name: 'Test Camera',
  slug: 'test-camera',
  brand: 'Sony',
  description: null,
  product_caption: null,
  image_urls: [],
  specifications: null,
  sale_price: null,
  sale_only: false,
  product_code: 'CAM-001',
  parent_product_id: null,
  content_blocks: [],
  keywords: [],
};

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  };
}

function makeFormRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as Request;
}

// ── add_inventory 스텁 팩토리 ────────────────────────────────────────────────
interface AddInventoryStubConfig {
  generateInvCodeError?: boolean;
}

function makeAddInventoryAdmin(config: AddInventoryStubConfig = {}) {
  // INSERT 호출 캡처용
  const insertFn = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'new-child-id' },
        error: null,
      }),
    }),
  }));

  const fromFn = vi.fn();

  // Call 1: from('products') — source lookup
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: SOURCE_PRODUCT, error: null }),
        }),
      }),
    }),
  });

  // Call 2: from('price_rules') — source price rules (returns empty → INSERT skipped)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  });

  // Call 3: from('products') — slug uniqueness check (RTN-3: add_inventory 모드에도 slug 중복확인 적용)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  // Call 4: from('products') — new product INSERT
  fromFn.mockReturnValueOnce({
    insert: insertFn,
  });

  const rpcFn = vi.fn((name: string) => {
    if (name === 'generate_inventory_product_code' && config.generateInvCodeError) {
      return Promise.resolve({ data: null, error: { message: 'code generation failed' } });
    }
    if (name === 'get_product_option_links') {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return { from: fromFn, rpc: rpcFn, _insertFn: insertFn };
}

// ── new_product 스텁 팩토리 ──────────────────────────────────────────────────
interface NewProductStubConfig {
  generateProductCodeError?: boolean;
}

function makeNewProductAdmin(config: NewProductStubConfig = {}) {
  const insertFn = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'cloned-product-id' },
        error: null,
      }),
    }),
  }));

  const fromFn = vi.fn();

  // Call 1: from('products') — source lookup
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { ...SOURCE_PRODUCT, product_code: null }, // new_product mode doesn't need product_code
            error: null,
          }),
        }),
      }),
    }),
  });

  // Call 2: from('price_rules') — source price rules (returns empty → INSERT skipped)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  });

  // Call 3: from('products') — slug uniqueness check (returns null = no conflict)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  // Call 4: from('products') — new product INSERT
  fromFn.mockReturnValueOnce({
    insert: insertFn,
  });

  const rpcFn = vi.fn((name: string) => {
    if (name === 'generate_product_code' && config.generateProductCodeError) {
      return Promise.resolve({ data: null, error: { message: 'code gen failed' } });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return { from: fromFn, rpc: rpcFn, _insertFn: insertFn };
}

beforeEach(() => {
  createClientMock.mockReset();
});

// ════════════════════════════════════════════════════════════════════════════
// TDD-PROD-2: add_inventory 모드 — is_active 기본값
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (add_inventory) — is_active 기본값', () => {
  it('[RED] 신규 재고 INSERT 시 is_active: true 이어야 함 (현재 false 로 RED 확인)', async () => {
    const admin = makeAddInventoryAdmin();
    createClientMock.mockReturnValue(admin);

    await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'parent-product-id',
        count: '1',
        mode: 'add_inventory',
        auto_code: 'true',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    // INSERT에 전달된 첫 번째 인자 캡처
    const insertedData = admin._insertFn.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(insertedData).toBeDefined();
    // RED: 현재 코드는 is_active: false → 이 assertion 실패해야 함
    expect(insertedData?.is_active).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TDD-PROD-2: add_inventory 모드 — generate_inventory_product_code 에러 처리
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (add_inventory) — generate_inventory_product_code 에러 처리', () => {
  it('[RED] 코드발행 RPC 실패 시 응답에 에러/경고 정보 포함 (현재 무시 → RED 확인)', async () => {
    const admin = makeAddInventoryAdmin({ generateInvCodeError: true });
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'parent-product-id',
        count: '1',
        mode: 'add_inventory',
        auto_code: 'true',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    // RED: 현재 코드는 에러를 무시하고 { success: true, ... } 만 반환
    // GREEN 후: warnings 또는 status 500 포함해야 함
    const r = result as Record<string, unknown>;
    const hasErrorInfo = r?.status === 500 || r?.warnings || (r?.data as Record<string, unknown>)?.warnings;
    expect(hasErrorInfo).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TDD-PROD-3: new_product 모드 — generate_product_code 에러 처리
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (new_product) — generate_product_code 에러 처리', () => {
  it('[RED] 품번발행 RPC 실패 시 응답에 에러/경고 정보 포함 (현재 무시 → RED 확인)', async () => {
    const admin = makeNewProductAdmin({ generateProductCodeError: true });
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    // RED: 현재 코드는 에러를 무시하고 { success: true, ... } 만 반환
    const r = result as Record<string, unknown>;
    const hasErrorInfo = r?.status === 500 || r?.warnings || (r?.data as Record<string, unknown>)?.warnings;
    expect(hasErrorInfo).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 버그 수정(2026-08-17): new_product 모드 — 원본 code_series(기준 코드품번) 계승
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (new_product) — 원본 code_series 계승 채번', () => {
  it('[GREEN] 원본에 2단 계층 code_series(parent_max_sequence)가 있으면 동일 category_code로 7-param 호출', async () => {
    const insertFn = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'cloned-product-id' }, error: null }),
      }),
    }));
    const fromFn = vi.fn();
    // Call 1: source lookup — 2단 계층 code_series 포함(예: 원본 CSPHSAM0040000)
    fromFn.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                ...SOURCE_PRODUCT,
                product_code: null,
                code_series: {
                  category_code: 'PHSAM',
                  year_month: 'nodate',
                  prefix: 'CS',
                  suffix: '',
                  seq_digits: 4,
                  max_sequence: 9999,
                  parent_seq: 4,
                  parent_seq_digits: 3,
                  parent_max_sequence: 999,
                },
              },
              error: null,
            }),
          }),
        }),
      }),
    });
    fromFn.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ is: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      }),
    });
    fromFn.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      }),
    });
    fromFn.mockReturnValueOnce({ insert: insertFn });

    const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    });

    createClientMock.mockReturnValue({ from: fromFn, rpc: rpcFn });

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.success).toBe(true);

    const codeCall = rpcCalls.find((c) => c.name === 'generate_product_code');
    expect(codeCall).toBeDefined();
    expect(codeCall?.params).toMatchObject({
      p_category_code_override: 'PHSAM',
      p_parent_max_sequence: 999,
      p_max_sequence: 9999,
      p_date_option: 'none',
      p_code_id: null,
    });
  });

  it('[GREEN 회귀] 원본에 code_series가 없는 레거시 상품은 기존 3-param 폴백 그대로 유지', async () => {
    const admin = makeNewProductAdmin();
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.success).toBe(true);
    // makeNewProductAdmin의 rpcFn은 파라미터 형태와 무관하게 성공 응답 — 호출 자체가
    // 3-param이든 7-param이든 에러 없이 완주하는지가 핵심(SOURCE_PRODUCT에 code_series 없음)
  });
});

// ── 회귀 방지: add_inventory 성공 케이스 ────────────────────────────────────
describe('cloneProduct (add_inventory) — 정상 동작 (회귀 방지)', () => {
  it('정상 요청 시 { success: true, mode: add_inventory } 반환', async () => {
    const admin = makeAddInventoryAdmin();
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'parent-product-id',
        count: '1',
        mode: 'add_inventory',
        auto_code: 'true',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    const r = result as Record<string, unknown>;
    expect(r?.success).toBe(true);
    expect(r?.mode).toBe('add_inventory');
  });
});

// ── 회귀 방지: new_product 성공 케이스 ──────────────────────────────────────
describe('cloneProduct (new_product) — 정상 동작 (회귀 방지)', () => {
  it('정상 요청 시 { success: true } 반환', async () => {
    const admin = makeNewProductAdmin();
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    const r = result as Record<string, unknown>;
    expect(r?.success).toBe(true);
  });
});
