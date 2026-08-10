import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD-5 RED — generate_inventory_product_code 2단 모드: max_sequence_exceeded 에러 처리 검증
 *
 * 대상: src/routes/cms/products/+page.server.ts (cloneProduct/add_inventory 액션)
 *
 * 검증 포인트:
 *   빠른 재고 등록 시 generate_inventory_product_code가 'max_sequence_exceeded' 에러를
 *   반환하면, 재시도 1회 후에도 동일 에러 → 즉시 fail(400)으로 사용자에게 명확한 에러를 반환해야 한다.
 *   현재 코드는 codeErr를 warning으로만 처리하고 success: true를 반환하므로 이 테스트는 실패(RED).
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

const { actions } = await import('../../routes/cms/products/+page.server');

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  };
}

function makeAddInventoryRequest() {
  const fd = new FormData();
  fd.append('mode', 'add_inventory');
  fd.append('source_product_id', 'root-product-id');  // ← 정확한 필드명
  fd.append('count', '1');
  fd.append('auto_code', 'true');
  return { formData: async () => fd } as Request;
}

/**
 * add_inventory 모드에서 generate_inventory_product_code가 max_sequence_exceeded 에러를 반환하는 스텁
 * 
 * cloneProduct add_inventory 흐름:
 * from(1): products SELECT (source 조회, code_series 포함)
 * from(2): price_rules SELECT
 * from(3): products SELECT (slug 중복 체크 — maybySingle)
 * from(4): products INSERT (새 자식)
 * rpc: generate_inventory_product_code → max_sequence_exceeded
 * rpc(retry): generate_inventory_product_code → max_sequence_exceeded
 * → fail(400) 기대 [RED: 현재는 warning만]
 */
function makeMaxSeqExceededStub() {
  const rpcFn = vi.fn((name: string) => {
    if (name === 'generate_inventory_product_code') {
      return Promise.resolve({
        data: null,
        error: {
          message: 'max_sequence_exceeded: 이 부모(root-product-id)의 재고 순번 상한(5)에 도달했습니다.',
          code: 'P0001',
        },
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  const fromFn = vi.fn();

  // 1회차: source 상품 조회 (code_series, parent_product_id 포함)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'root-product-id',
              name: '테스트 카메라',
              slug: 'test-camera',
              category: 'camera',
              brand: null,
              description: null,
              product_caption: null,
              image_urls: [],
              specifications: null,
              sale_price: null,
              sale_only: false,
              product_code: null,
              code_series: {  // 2단 모드 부모: parent_seq_digits 포함
                category_code: 'CAM',
                year_month: '2608',
                prefix: 'CS',
                suffix: '',
                seq_digits: 3,
                max_sequence: 5,           // 자식 순번2 상한 = 5
                parent_seq: 1,
                parent_seq_digits: 2,
                parent_max_sequence: 99,
              },
              parent_product_id: null,
              content_blocks: null,
              keywords: null,
            },
            error: null,
          }),
        }),
      }),
    }),
  });

  // 2회차: price_rules SELECT
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  });

  // 3회차: slug 중복 체크 (maybySingle) → null = 중복 없음
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  });

  // 4회차: products INSERT (새 자식)
  fromFn.mockReturnValueOnce({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'new-child-id' },
          error: null,
        }),
      }),
    }),
  });

  // 이후 호출 — 기본 성공
  fromFn.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  });

  return { from: fromFn, rpc: rpcFn };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe('TDD-5 RED — 2단 모드 자식 순번 상한 초과 에러 처리', () => {
  it('[RED] 빠른 재고 등록 시 max_sequence_exceeded 에러를 받으면 success:true가 아닌 fail(400)을 반환한다', async () => {
    const admin = makeMaxSeqExceededStub();
    createClientMock.mockReturnValue(admin);

    let result: unknown;
    try {
      result = await actions.cloneProduct({
        request: makeAddInventoryRequest(),
        locals: makeLocals(),
      } as Parameters<typeof actions.cloneProduct>[0]);
    } catch (e) {
      result = e;
    }

    // [RED] 현재 코드는 warning만 기록하고 { success: true, cloned: 1, ... }을 반환함.
    // GREEN 달성 후: max_sequence_exceeded → fail(400) 반환, success: true 미반환.
    
    // 현재 코드가 success: true를 반환하는지 확인 (RED를 명시적으로 보여줌)
    const isSuccessfulResult = (result !== null && typeof result === 'object' && 
                                 'success' in (result as Record<string, unknown>) && 
                                 (result as Record<string, unknown>).success === true);
    expect(isSuccessfulResult).toBe(false); // RED: 현재는 true라서 실패
  });
});
