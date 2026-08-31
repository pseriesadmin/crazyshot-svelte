import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage 4 TDD: RSV-B-C4 — 두발히어로 배송 취소 후 tracking_number NULL 초기화
 *
 * 문제: cancelDelivery 성공 후 rental_reservations.tracking_number를 NULL로 초기화하지 않아
 *       UI에서 취소 후에도 이전 운송장 번호가 계속 표시되고, POST 멱등성 가드(RSV-B-C3)도
 *       여전히 이미 접수된 것으로 판단해 재접수 불가 상태가 된다.
 *
 * 수정: cancelDelivery 성공 후 clear_reservation_tracking_number RPC 호출 (fail-soft).
 * 412 문구: "이미 배송이 출발해 취소할 수 없습니다..." → 원문 유지(기존 문구가 이미 적절)
 *
 * EC-4:  취소 성공 → clear_reservation_tracking_number RPC 호출 + ok:true
 * EC-4b: 412 에러 → RPC 미호출, dhero_cancel_failed:true (이미 출발)
 */

const mockEnv = vi.hoisted(() => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }));
vi.mock('$env/static/private', () => mockEnv);
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

const mockCancelDelivery = vi.fn();
class MockDheroApiError extends Error {
  statusCode: number;
  constructor(msg: string, code: number) { super(msg); this.statusCode = code; }
}
vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: (...args: unknown[]) => mockCancelDelivery(...args),
  DheroApiError:  MockDheroApiError,
}));

const { PUT } = await import('../../routes/api/cms/reservations/[id]/dhero/cancel/+server');

function makeLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) };
}

function setupFrom(trackingNumber: string | null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { tracking_number: trackingNumber }, error: null }),
  });
}

describe('RSV-B-C4: 두발히어로 취소 후 tracking_number NULL 초기화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('EC-4: 취소 성공 → clear_reservation_tracking_number RPC 호출됨', async () => {
    setupFrom('BOOK-123');
    mockCancelDelivery.mockResolvedValue(undefined); // 성공

    const res = await PUT({
      params:  { id: '10' },
      locals:  makeLocals(),
      request: {} as Request,
      url:     new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // clear_reservation_tracking_number RPC가 호출됐는지 확인
    const clearCalls = mockRpc.mock.calls.filter(
      (c: unknown[]) => (c[0] as string) === 'clear_reservation_tracking_number'
    );
    expect(clearCalls.length).toBe(1);
    expect((clearCalls[0][1] as { p_reservation_id: number }).p_reservation_id).toBe(10);
  });

  it('EC-4b: 412 에러 → RPC 미호출, dhero_cancel_failed 반환', async () => {
    setupFrom('BOOK-999');
    mockCancelDelivery.mockRejectedValue(new MockDheroApiError('배송 진행 중', 412));

    const res = await PUT({
      params:  { id: '10' },
      locals:  makeLocals(),
      request: {} as Request,
      url:     new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(422);
    const body = await res.json() as { dhero_cancel_failed: boolean };
    expect(body.dhero_cancel_failed).toBe(true);

    // tracking_number 초기화 RPC는 호출 안 됨
    const clearCalls = mockRpc.mock.calls.filter(
      (c: unknown[]) => (c[0] as string) === 'clear_reservation_tracking_number'
    );
    expect(clearCalls.length).toBe(0);
  });
});
