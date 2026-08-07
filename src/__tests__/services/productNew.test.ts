import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-PROD-1 — products/new 등록: QR payload UPDATE + auto_create_inventory_for_product
 *              에러 무시 수정 (TDD RED → GREEN)
 *
 * 대상: src/routes/cms/products/new/+page.server.ts
 *
 * 결함:
 *   line 208: `await admin.from('products').update(...)` — 에러 체크 없음
 *   line 314: `await admin.rpc('auto_create_inventory_for_product', ...)` — 에러 체크 없음
 *
 * 승인된 수정 방향: 두 호출 모두 { error } 확인 후 실패 시
 *   - redirect URL에 regWarn 쿼리 파라미터 포함해 관리자에게 알림
 *   - 상품 등록 자체(INSERT)는 유지
 *
 * 테스트 전략: vi.mock으로 Supabase client + env 모킹, create action 직접 import,
 *   redirect 예외를 catch해 location 검증.
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

// vi.mock 호이스팅 후 동적 import
const { actions } = await import('../../routes/cms/products/new/+page.server');

// ── 타입 ────────────────────────────────────────────────────────────────────
interface RpcCallConfig {
  generateProductCodeError?: boolean;
  autoCreateInventoryError?: boolean;
}

interface AdminStubConfig {
  qrUpdateError?: boolean;
  rpcConfig?: RpcCallConfig;
}

// ── 스텁 팩토리 ─────────────────────────────────────────────────────────────
/**
 * from('products')는 create action 내에서 3회 호출됨:
 *   1회: slug 중복 체크 (select.eq.is.maybeSingle)
 *   2회: 상품 INSERT (insert.select.single)
 *   3회: QR payload UPDATE (update.eq) ← 에러 대상
 */
function makeAdminStub(config: AdminStubConfig = {}) {
  const rpcFn = vi.fn((name: string) => {
    const rpcConfig = config.rpcConfig ?? {};
    if (name === 'auto_create_inventory_for_product' && rpcConfig.autoCreateInventoryError) {
      return Promise.resolve({ data: null, error: { message: 'inventory creation failed' } });
    }
    // generate_product_code 등 나머지 RPC는 성공
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
      eq: vi.fn().mockResolvedValue({
        data: null,
        error: config.qrUpdateError ? { message: 'QR update failed' } : null,
      }),
    }),
  });

  // 이후 호출(price_rules insert 등) — 성공 기본값
  fromFn.mockReturnValue({
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  return { from: fromFn, rpc: rpcFn };
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
function makeLocals(hasSession = true) {
  return {
    safeGetSession: async () =>
      hasSession
        ? { session: { user: { id: 'test-admin-id' } } }
        : { session: null },
  };
}

/**
 * 최소 필드만 포함한 신규 상품 FormData
 * category 직접 지정 → group_id 없음 → code_mapping_groups 조회 스킵
 * combo_row_id 없음 → code_mapping_items/product_category_codes 조회 스킵
 * option_links 없음 → upsert_product_option_links RPC 스킵
 *
 * 기본값:
 *  - sale_only: 'false' — 명시적 기본값 (가격 검증 로직 진입)
 *  - price_24h: '50000' — 24h 필수 체크 통과 (sale_only=false 시 QR/inv 에러 테스트 목적)
 *
 * overrides는 fd.set()으로 적용되므로 기본값을 정확히 대체함.
 * sale_only=true 테스트처럼 price_24h를 제외하려면 별도 헬퍼 사용.
 */
function makeMinimalFormRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('name', 'Test Product');
  fd.append('slug', 'test-product');
  fd.append('category', 'camera');
  fd.append('is_active', 'true');
  fd.append('sale_only', 'false');   // TDD-SALEONLY-1: 명시적 기본값
  fd.append('price_24h', '50000');   // TDD-SALEONLY-1: 24h 필수 체크 통과 — QR/inv 에러 테스트
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v);  // set()으로 기본값 대체 보장
  }
  return { formData: async () => fd } as Request;
}

/**
 * sale_only=true 전용 FormData — price_24h 의도적 미포함
 * 서버가 sale_only 여부를 무시하고 price_24h 필수 체크를 강행하는 버그 재현용
 */
function makeSaleOnlyRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('name', 'Sale Only Product');
  fd.append('slug', 'sale-only-product');
  fd.append('category', 'camera');
  fd.append('is_active', 'true');
  fd.append('sale_only', 'true');
  fd.append('sale_price', '150000');
  // price_24h 미포함 — sale_only=true 시 이 값 없어도 등록 가능해야 함
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v);
  }
  return { formData: async () => fd } as Request;
}

/**
 * create action을 호출하고 redirect 위치 또는 fail 결과를 반환
 */
async function callCreate(options: {
  request: Request;
  locals?: ReturnType<typeof makeLocals>;
}) {
  const locals = options.locals ?? makeLocals();
  try {
    const result = await actions.create({
      request: options.request,
      locals,
    } as Parameters<typeof actions.create>[0]);
    return { result, redirectLocation: null };
  } catch (e: unknown) {
    // SvelteKit redirect() throws { status, location }
    const r = e as { location?: string; status?: number };
    if (r.location) {
      return { result: null, redirectLocation: r.location };
    }
    throw e; // 예상치 못한 예외는 그대로 전파
  }
}

beforeEach(() => {
  createClientMock.mockReset();
});

// ── RED 테스트: QR update 실패 ───────────────────────────────────────────────
describe('create action — QR payload UPDATE 실패 경고', () => {
  it('[RED] QR update 에러 시 redirect URL에 regWarn 포함', async () => {
    const admin = makeAdminStub({ qrUpdateError: true });
    createClientMock.mockReturnValue(admin);

    const { redirectLocation } = await callCreate({
      request: makeMinimalFormRequest(),
    });

    // RED: 현재 코드는 에러를 무시하고 regWarn 없이 redirect → 이 assertion이 실패해야 함
    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toMatch(/regWarn/);
  });
});

// ── RED 테스트: inventory RPC 실패 ──────────────────────────────────────────
describe('create action — auto_create_inventory_for_product RPC 실패 경고', () => {
  it('[RED] 재고 자동생성 RPC 에러 시 redirect URL에 regWarn 포함', async () => {
    const admin = makeAdminStub({
      rpcConfig: { autoCreateInventoryError: true },
    });
    createClientMock.mockReturnValue(admin);

    const { redirectLocation } = await callCreate({
      request: makeMinimalFormRequest(),
    });

    // RED: 현재 코드는 에러를 무시하고 regWarn 없이 redirect → 이 assertion이 실패해야 함
    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toMatch(/regWarn/);
  });
});

// ── RED 테스트: 두 에러 동시 발생 ───────────────────────────────────────────
describe('create action — QR update + inventory RPC 동시 실패', () => {
  it('[RED] 두 호출 모두 실패 시 redirect URL에 regWarn 포함', async () => {
    const admin = makeAdminStub({
      qrUpdateError: true,
      rpcConfig: { autoCreateInventoryError: true },
    });
    createClientMock.mockReturnValue(admin);

    const { redirectLocation } = await callCreate({
      request: makeMinimalFormRequest(),
    });

    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toMatch(/regWarn/);
  });
});

// ── HAPPY: 에러 없을 때 정상 redirect (회귀 방지) ───────────────────────────
describe('create action — 정상 등록 (회귀 방지)', () => {
  it('에러 없을 때 /cms/products?selected= 로 redirect', async () => {
    const admin = makeAdminStub(); // 모든 호출 성공
    createClientMock.mockReturnValue(admin);

    const { redirectLocation } = await callCreate({
      request: makeMinimalFormRequest(),
    });

    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toContain('/cms/products?selected=test-product-id');
    // 경고 없음
    expect(redirectLocation).not.toContain('regWarn');
  });

  it('세션 없으면 fail(401) 반환', async () => {
    const admin = makeAdminStub();
    createClientMock.mockReturnValue(admin);

    const { result } = await callCreate({
      request: makeMinimalFormRequest(),
      locals: makeLocals(false),
    });

    expect(result).not.toBeNull();
    const r = result as { status?: number };
    expect(r.status).toBe(401);
  });
});

// ── TDD-SALEONLY-1: sale_only 버그 RED 테스트 ────────────────────────────────
// 현재 코드는 saleOnly 여부 무관하게 price_24h 필수 체크를 무조건 실행 →
// sale_only=true 상품이 price_24h 없으면 fail(400)으로 차단되는 버그.
// 아래 테스트는 GREEN 이전까지 실패(RED)해야 한다.
describe('create action — sale_only=true 상품 등록 (TDD-SALEONLY-1)', () => {
  it('[RED] sale_only=true 시 price_24h 없어도 /cms/products?selected= 로 redirect 성공', async () => {
    const admin = makeAdminStub();
    createClientMock.mockReturnValue(admin);

    const { redirectLocation, result } = await callCreate({
      request: makeSaleOnlyRequest(),
    });

    // RED: 현재 코드는 price_24h 필수 체크에서 fail(400) 반환 → redirectLocation=null
    // GREEN 이후: redirectLocation이 /cms/products?selected=... 를 포함해야 함
    expect(redirectLocation).not.toBeNull();
    expect(redirectLocation).toContain('/cms/products?selected=test-product-id');
    expect(result).toBeNull(); // fail() 반환이 아님
  });

  it('sale_only=false 시 price_24h 없으면 fail(400) 반환 (회귀 방지)', async () => {
    const admin = makeAdminStub();
    createClientMock.mockReturnValue(admin);

    // sale_only=false + price_24h 없음 → 기존대로 차단되어야 함
    const fd = new FormData();
    fd.append('name', 'Normal Product');
    fd.append('slug', 'normal-product');
    fd.append('category', 'camera');
    fd.append('is_active', 'true');
    fd.append('sale_only', 'false');
    // price_24h 미포함 — 기존 차단 로직 유지 확인
    const request = { formData: async () => fd } as Request;

    const { result, redirectLocation } = await callCreate({ request });

    expect(redirectLocation).toBeNull();
    expect(result).not.toBeNull();
    const r = result as { status?: number };
    expect(r.status).toBe(400);
  });
});
