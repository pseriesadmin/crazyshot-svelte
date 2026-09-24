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

// ── new_product 스텁 팩토리 (테이블명 기준 — 코드조합 조회 체인 포함) ─────────
interface NewProductStubConfig {
  generateProductCodeError?: boolean;
  comboGroupCategory?: string | null; // 선택한 조합이 속한 그룹의 default_category
  comboParentMax?: number | null; // 순번1(부모 순번) 상한 — null이면 1단 조합
  dateOption?: string;
  existingSameCodeParent?: boolean; // 같은 조합·같은 연월의 1단 부모가 이미 존재
}

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'contains', 'not']) c[m] = () => c;
  c.single = () => Promise.resolve(result);
  c.maybeSingle = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

const COMBO_ROW_ID = 'combo-row-1';

function makeNewProductAdmin(config: NewProductStubConfig = {}) {
  const insertFn = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'cloned-product-id' }, error: null }),
    }),
  }));

  let productsSelectCalls = 0;
  const fromFn = vi.fn((table: string) => {
    if (table === 'products') {
      return {
        // 첫 select = 원본 조회, 이후 select = slug 중복확인(충돌 없음)
        // 1번째 select = 원본 조회, 2번째 = 동일 부모코드 존재 확인, 이후 = slug 중복확인(충돌 없음)
        select: () => {
          const n = productsSelectCalls++;
          if (n === 0) return chain({ data: { ...SOURCE_PRODUCT, product_code: null }, error: null });
          if (n === 1) {
            return chain({
              data: config.existingSameCodeParent ? [{ id: 'existing-parent', code_series: { category_code: 'NEW', year_month: 'nodate' } }] : [],
              error: null,
            });
          }
          return chain({ data: null, error: null });
        },
        insert: insertFn,
      };
    }
    if (table === 'price_rules') return { select: () => chain({ data: [], error: null }), insert: vi.fn() };
    if (table === 'code_mapping_items') {
      return { select: () => chain({ data: [{ group_id: 'group-1', taxonomy_code_id: 'tc-1', date_option: config.dateOption ?? 'ymd', max_sequence: 9999, parent_max_sequence: config.comboParentMax ?? null }], error: null }) };
    }
    if (table === 'code_mapping_groups') {
      return { select: () => chain({ data: { default_category: config.comboGroupCategory === undefined ? 'camera' : config.comboGroupCategory }, error: null }) };
    }
    if (table === 'product_category_codes') {
      return { select: () => chain({ data: [{ id: 'tc-1', code: 'NEW', code_tier: null, depth: 0 }], error: null }) };
    }
    return { select: () => chain({ data: null, error: null }) };
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
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    const r = result as Record<string, unknown>;
    const hasErrorInfo = r?.status === 500 || r?.warnings || (r?.data as Record<string, unknown>)?.warnings;
    expect(hasErrorInfo).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 정책(2026-09-24): 새 상품 복제 = 새로운 부모상품 등록 → 원본과 동일한 코드품번 구조를
// 그대로 물려받는 복제(동일 부모코드품번 상품 중복 존재)를 차단, 코드조합 선택 필수
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (new_product) — 코드조합 선택 필수', () => {
  it('[GREEN] 코드조합 미선택(자동 생성 모드) 시 400 차단 — 상품 INSERT·품번 발행 호출 없음', async () => {
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

    expect((result as Record<string, unknown>)?.status).toBe(400);
    expect(admin._insertFn).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalledWith('generate_product_code', expect.anything());
  });

  it('[GREEN] 선택한 조합이 다른 카테고리 소속이면 400 차단(자동 생성 모드)', async () => {
    const admin = makeNewProductAdmin({ comboGroupCategory: 'lens' });
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.status).toBe(400);
    expect(admin._insertFn).not.toHaveBeenCalled();
  });

  it('[GREEN] 코드조합 선택 시 원본 code_series가 아니라 선택한 조합의 구조로 7-param 발행', async () => {
    const admin = makeNewProductAdmin();
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.success).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith('generate_product_code', expect.objectContaining({
      p_category_code_override: 'NEW',
      p_date_option: 'ymd',
      p_max_sequence: 9999,
      p_code_id: 'tc-1',
    }));
  });

  it('[GREEN] 같은 조합·같은 연월의 1단 부모가 이미 있으면 400 차단(동일 부모 코드품번 방지)', async () => {
    const admin = makeNewProductAdmin({ dateOption: 'none', existingSameCodeParent: true });
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.status).toBe(400);
    expect(admin._insertFn).not.toHaveBeenCalled();
  });

  it('[GREEN] 새 상품 복제는 수량을 2로 보내도 항상 1개만 등록(동일 부모 코드품번 중복 방지)', async () => {
    const admin = makeNewProductAdmin();
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '2',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.cloned).toBe(1);
    expect(admin._insertFn).toHaveBeenCalledTimes(1);
  });

  it('[GREEN] 순번1이 있는 2단 조합은 동일 조합이 이미 있어도 통과(부모 순번이 매번 +1)', async () => {
    const admin = makeNewProductAdmin({ comboParentMax: 999, dateOption: 'none', existingSameCodeParent: true });
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '2',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 새 상품 복제 — 장치정보·이력 제외 모든 정보(대여정책·구성품·옵션상품 포함) 복제
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (new_product) — 전체 정보 복제', () => {
  it('[GREEN] 대여정책·구성품·배송옵션을 INSERT에 포함하고 옵션상품 연결을 복사한다', async () => {
    const base = makeNewProductAdmin();
    const rpcMock = vi.fn((name: string) => {
      if (name === 'get_product_option_links') {
        return Promise.resolve({ data: [{ option_product_id: 'opt-1', is_required: true }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const admin = { ...base, rpc: rpcMock };
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({
        source_product_id: 'source-product-id',
        count: '1',
        mode: 'new_product',
        auto_code: 'true',
        partner_code: 'false',
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.success).toBe(true);
    const inserted = admin._insertFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted).toHaveProperty('components');
    expect(inserted).toHaveProperty('allowed_period_ids');
    expect(inserted).toHaveProperty('allowed_method_ids');
    expect(inserted).toHaveProperty('allowed_pickup_ids');
    expect(inserted).toHaveProperty('shipping_round_trip');
    expect(admin.rpc).toHaveBeenCalledWith('upsert_product_option_links', {
      p_product_id: 'cloned-product-id',
      p_option_links: [{ option_product_id: 'opt-1', is_required: true }],
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 재고 추가 — 순번 상한 사전 차단 / 등록 수량 최대 50
// ════════════════════════════════════════════════════════════════════════════

describe('cloneProduct (add_inventory) — 순번 상한 사전 차단', () => {
  function makeCappedInventoryAdmin(nextSeq: number) {
    const insertFn = vi.fn();
    const fromFn = vi.fn((table: string) => {
      if (table === 'products') {
        return {
          select: () => chain({ data: { ...SOURCE_PRODUCT, code_series: { category_code: 'NEW', year_month: 'nodate', max_sequence: 3 } }, error: null }),
          insert: insertFn,
        };
      }
      if (table === 'product_code_sequences') return { select: () => chain({ data: { next_seq: nextSeq }, error: null }) };
      return { select: () => chain({ data: [], error: null }) };
    });
    return { from: fromFn, rpc: vi.fn(() => Promise.resolve({ data: null, error: null })), _insertFn: insertFn };
  }

  it('[GREEN] 남은 순번보다 많이 요청하면 재고를 하나도 만들지 않고 400 차단', async () => {
    const admin = makeCappedInventoryAdmin(3); // 상한 3, 다음 순번 3 → 남은 1개
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({ source_product_id: 'parent-product-id', count: '2', mode: 'add_inventory' }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    expect((result as Record<string, unknown>)?.status).toBe(400);
    expect(admin._insertFn).not.toHaveBeenCalled();
  });

  it('[GREEN] 등록 수량은 최대 50개로 제한된다', async () => {
    const admin = makeCappedInventoryAdmin(1); // 상한 3 → 남은 3개, 60 요청 → 50으로 절삭돼도 3 초과라 차단
    createClientMock.mockReturnValue(admin);

    const result = await actions.cloneProduct({
      request: makeFormRequest({ source_product_id: 'parent-product-id', count: '60', mode: 'add_inventory' }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    const r = result as { status?: number; data?: { error?: string } };
    expect(r.status).toBe(400);
    expect(r.data?.error).toContain('50개는 등록할 수 없습니다');
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
        partner_combo_row_id: COMBO_ROW_ID,
      }),
      locals: makeLocals(),
    } as Parameters<typeof actions.cloneProduct>[0]);

    const r = result as Record<string, unknown>;
    expect(r?.success).toBe(true);
  });
});
