import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage 1 TDD: RSV-B-C1 — cancel_reservation_payment RPC result.success 검증
 *
 * Toss 결제취소는 이미 성공한 뒤 RPC(DB 반영) 단계 실패를 다룬다.
 * - RPC가 success:false를 반환하면 3회 자동재시도 (Toss API 재호출 없음)
 * - 재시도 전부 실패 시 payment_transactions에 실패사실 기록 + 관리자 알림
 * - EC-1: success:false 반환 케이스
 * - EC-1b: 재시도 후 성공 케이스
 * - EC-1c: 재시도 전부 실패 케이스
 */

// ── 환경 mock ─────────────────────────────────────────────────────────────────
const mockEnv = vi.hoisted(() => ({
  TOSS_SECRET_KEY: 'test-toss-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}));
vi.mock('$env/static/private', () => mockEnv);
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
}));

// ── Supabase mock ──────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

// ── 의존 서비스 mock ────────────────────────────────────────────────────────────
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
  sendPushToAdmins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: vi.fn().mockResolvedValue(undefined),
  DheroApiError: class DheroApiError extends Error {
    statusCode: number;
    constructor(msg: string, code: number) { super(msg); this.statusCode = code; }
  },
}));

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: vi.fn().mockReturnValue(true),
}));

// ── 실제 핸들러 import ──────────────────────────────────────────────────────────
const { PUT } = await import('../../routes/api/cms/reservations/[id]/payment/+server');

// ── 헬퍼 ────────────────────────────────────────────────────────────────────────
function makeLocals() {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-uuid' } } }),
    supabase: {} as unknown,
  };
}

function makeParams(id = '123') {
  return { id };
}

function makeRequest(body = {}) {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Request;
}

// ── 공통 from chain 세팅 ────────────────────────────────────────────────────────
function setupFromChain(overrides: {
  ptRow?: Record<string, unknown> | null,
  rvRow?: Record<string, unknown> | null,
  updateResult?: unknown,
} = {}) {
  // payment_transactions 조회 (GET findOrderPaymentTransaction - direct)
  const ptDirect = overrides.ptRow ?? {
    payment_key: 'pk_test_123',
    status: 'done',
    order_id: 1,
  };
  const rvRow = overrides.rvRow ?? { status: 'hold' };

  let callCount = 0;
  mockFrom.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    if (table === 'payment_transactions') {
      callCount++;
      if (callCount === 1) {
        // direct query
        chain.maybeSingle.mockResolvedValue({ data: ptDirect, error: null });
      } else {
        // update (for failure recording)
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
    } else if (table === 'rental_reservations') {
      chain.maybeSingle.mockResolvedValue({ data: rvRow, error: null });
    } else {
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    }

    return chain;
  });
}

// ── Toss mock fetch ─────────────────────────────────────────────────────────────
function mockTossOk() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'CANCELED' }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그룹
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/cms/reservations/[id]/payment — RSV-B-C1: RPC result.success 검증', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('EC-1: RPC success:false → 500 반환, 환불완료 토스트 미발생 (재시도 후 전부 실패)', async () => {
    setupFromChain();
    mockTossOk();
    // RPC 항상 success:false 반환 (3회 전부)
    mockRpc.mockResolvedValue({ data: { success: false, error: 'PAYMENT_NOT_FOUND' }, error: null });

    const res = await PUT({
      params: makeParams(),
      locals: makeLocals(),
      request: makeRequest(),
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(500);
    const body = await res.json() as { error?: string };
    expect(body.error).toBeTruthy();

    // RPC는 3회 호출됐어야 함 (재시도)
    expect(mockRpc.mock.calls.filter((c: unknown[]) =>
      (c[0] as string) === 'cancel_reservation_payment'
    ).length).toBeGreaterThanOrEqual(2);
  });

  it('EC-1b: RPC 1회 실패 후 2회째 success:true → 200 반환', async () => {
    setupFromChain();
    mockTossOk();
    // 1회 실패, 2회 성공
    mockRpc
      .mockResolvedValueOnce({ data: { success: false, error: 'TRANSIENT' }, error: null })
      .mockResolvedValue({ data: { success: true, cancelled_reservation_ids: [123] }, error: null });

    const res = await PUT({
      params: makeParams(),
      locals: makeLocals(),
      request: makeRequest(),
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json() as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it('EC-1c: rpcErr(네트워크 오류) 시에도 재시도 후 전부 실패하면 500', async () => {
    setupFromChain();
    mockTossOk();
    // 네트워크 에러 반환
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const res = await PUT({
      params: makeParams(),
      locals: makeLocals(),
      request: makeRequest(),
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(500);
  });

  it('정상 케이스: success:true → 200, cancelledIds 반환', async () => {
    setupFromChain();
    mockTossOk();
    mockRpc.mockResolvedValue({
      data: { success: true, cancelled_reservation_ids: [123, 456] },
      error: null,
    });

    const res = await PUT({
      params: makeParams(),
      locals: makeLocals(),
      request: makeRequest(),
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json() as { ok?: boolean; cancelledIds?: number[] };
    expect(body.ok).toBe(true);
    expect(body.cancelledIds).toEqual([123, 456]);
  });
});
