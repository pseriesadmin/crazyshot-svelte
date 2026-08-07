import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-SALEONLY-2 — updateSection pricing 분기: sale_only 상품 24시간 가격 필수 체크 버그
 *
 * 대상: src/routes/cms/products/+page.server.ts — updateSection 액션 pricing 분기 (~654-656)
 *
 * 결함: saleOnly 여부와 무관하게 price_24h 필수 체크가 무조건 실행됨.
 * 수정 방향: !saleOnly 조건 추가 — sale_only=true 시 24h 필수 체크 스킵.
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

// ── 스텁 팩토리 ─────────────────────────────────────────────────────────────
/**
 * updateSection pricing 호출 시퀀스 (pricing + not child):
 *   1. from('products').select('parent_product_id').eq.single → {parent_product_id: null}
 *   2. from('products').update({sale_price, sale_only}).eq
 *   (이후 price_rules 처리 — 가격 입력 없으면 루프 내 DB 호출 없음)
 */
function makeUpdateSectionAdminStub() {
  const fromFn = vi.fn();

  // 1st: childCheck
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { parent_product_id: null }, error: null }),
      }),
    }),
  });

  // 이후 모든 from() 호출: products.update 또는 price_rules 작업 — 전부 성공
  fromFn.mockReturnValue({
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  return { from: fromFn, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  };
}

function makePricingFormRequest(fields: Record<string, string>) {
  const fd = new FormData();
  fd.append('product_id', 'test-product-id');
  fd.append('section_type', 'pricing');
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return { formData: async () => fd } as Request;
}

async function callUpdateSection(options: {
  request: Request;
  locals?: ReturnType<typeof makeLocals>;
}) {
  const locals = options.locals ?? makeLocals();
  return actions.updateSection({
    request: options.request,
    locals,
  } as Parameters<typeof actions.updateSection>[0]);
}

beforeEach(() => {
  createClientMock.mockReset();
});

// ── TDD-SALEONLY-2 RED 테스트 ────────────────────────────────────────────────
describe('updateSection pricing — sale_only=true 상품 수정 (TDD-SALEONLY-2)', () => {
  it('[RED] sale_only=true 시 price_24h 없어도 {success:true} 반환', async () => {
    const admin = makeUpdateSectionAdminStub();
    createClientMock.mockReturnValue(admin);

    const result = await callUpdateSection({
      request: makePricingFormRequest({
        sale_only: 'true',
        sale_price: '150000',
        // price_24h 미포함 — sale_only=true 이므로 필수 체크 스킵되어야 함
      }),
    });

    // RED: 현재 코드는 price_24h 필수 체크에서 fail(400) 반환
    // GREEN 이후: {success:true, sectionType:'pricing'} 반환
    const r = result as { success?: boolean; sectionType?: string; status?: number };
    expect(r.success).toBe(true);
    expect(r.sectionType).toBe('pricing');
  });

  it('sale_only=false 시 price_24h 없으면 fail(400) 반환 (회귀 방지)', async () => {
    const admin = makeUpdateSectionAdminStub();
    createClientMock.mockReturnValue(admin);

    const result = await callUpdateSection({
      request: makePricingFormRequest({
        sale_only: 'false',
        // price_24h 미포함 — 기존대로 차단
      }),
    });

    const r = result as { status?: number };
    expect(r.status).toBe(400);
  });

  it('sale_only=false + price_24h 있으면 {success:true} 반환 (정상 경로 회귀)', async () => {
    const admin = makeUpdateSectionAdminStub();
    createClientMock.mockReturnValue(admin);

    const result = await callUpdateSection({
      request: makePricingFormRequest({
        sale_only: 'false',
        price_24h: '50000',
      }),
    });

    const r = result as { success?: boolean; sectionType?: string };
    expect(r.success).toBe(true);
    expect(r.sectionType).toBe('pricing');
  });
});
