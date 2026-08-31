import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /cms/customers/membership 구독정보·구독결제고객 정보 반영 개발보완 플랜 Part C (TDD)
 * GET /api/cron/subscription-billing — 정기 재청구 크론 라우트
 *
 * 범위:
 *   - CRON_SECRET 미설정/불일치 → 401 (fail-closed)
 *   - 정상 인증 + 청구대상 0건 → 200, processed:0
 *   - 정상 인증 + claim된 여러 건 중 일부 chargeSubscription 실패 → 나머지는 계속 처리(개별 격리)
 *
 * 실제 Toss API/DB는 호출하지 않음 — chargeSubscription()과 claim RPC 결과를 모킹.
 * chargeSubscription() 자체의 청구 로직은 subscriptionBillingClaim.test.ts(RPC 레벨)에서
 * 이미 실 DB로 검증됨.
 */

const mockEnv = vi.hoisted(() => ({
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  // 정기결제(빌링, mid=bill_crazyhevr) 전용 키로 분리(2026-08-30) — 단건결제 TOSS_SECRET_KEY와 별개
  TOSS_BILLING_SECRET_KEY: 'test-toss-billing-secret',
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
}));

const mockRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc }),
}));

const mockChargeSubscription = vi.fn();
vi.mock('$lib/server/subscriptions/chargeSubscription', () => ({
  chargeSubscription: (...args: unknown[]) => mockChargeSubscription(...args),
}));

const { GET } = await import('../../routes/api/cron/subscription-billing/+server');

function makeRequest(authHeader: string | null): Request {
  return {
    headers: { get: (name: string) => (name === 'authorization' ? authHeader : null) },
  } as unknown as Request;
}

describe('GET /api/cron/subscription-billing — 인증(fail-closed)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockEnv.CRON_SECRET = 'test-cron-secret'; });

  it('RED: CRON_SECRET 미설정 시 401 반환(인증 헤더가 있어도)', async () => {
    mockEnv.CRON_SECRET = '';
    const res = await GET({ request: makeRequest('Bearer anything') } as never) as { status: number };
    expect(res.status).toBe(401);
  });

  it('RED: Authorization 헤더 없음 → 401', async () => {
    const res = await GET({ request: makeRequest(null) } as never) as { status: number };
    expect(res.status).toBe(401);
  });

  it('RED: Authorization 헤더 값 불일치 → 401', async () => {
    const res = await GET({ request: makeRequest('Bearer wrong-secret') } as never) as { status: number };
    expect(res.status).toBe(401);
  });

  it('GREEN: 올바른 CRON_SECRET → 401 아님(claim 0건이면 200)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const res = await GET({ request: makeRequest('Bearer test-cron-secret') } as never) as { status: number; json: () => Promise<unknown> };
    expect(res.status).toBe(200);
    const body = await res.json() as { processed: number };
    expect(body.processed).toBe(0);
  });
});

describe('GET /api/cron/subscription-billing — 배치 처리 + 개별 실패 격리', () => {
  beforeEach(() => { vi.clearAllMocks(); mockEnv.CRON_SECRET = 'test-cron-secret'; });

  it('GREEN: claim된 3건 중 1건 chargeSubscription 실패해도 나머지 2건은 처리된다', async () => {
    const claimedBatch = [
      { id: 1, user_id: 'u1', plan_id: 10, billing_key: 'bk1', monthly_price: 9900, plan_name: 'EASY' },
      { id: 2, user_id: 'u2', plan_id: 10, billing_key: 'bk2', monthly_price: 9900, plan_name: 'EASY' },
      { id: 3, user_id: 'u3', plan_id: 10, billing_key: 'bk3', monthly_price: 9900, plan_name: 'EASY' },
    ];
    // 1차 호출: 3건(BATCH_SIZE=20보다 적음) → 루프 종료
    mockRpc.mockResolvedValueOnce({ data: claimedBatch, error: null });

    mockChargeSubscription
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Toss network error'))
      .mockResolvedValueOnce({ success: false, error: 'CARD_DECLINED' });

    const res = await GET({ request: makeRequest('Bearer test-cron-secret') } as never) as { status: number; json: () => Promise<unknown> };
    const body = await res.json() as { processed: number; succeeded: number; failed: number; errors: unknown[] };

    expect(res.status).toBe(200);
    expect(body.processed).toBe(3);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.errors).toHaveLength(2);
    expect(mockChargeSubscription).toHaveBeenCalledTimes(3);
  });

  it('RED: claim RPC 자체가 에러를 반환하면 처리 없이 에러를 기록하고 종료한다', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'db unavailable' } });

    const res = await GET({ request: makeRequest('Bearer test-cron-secret') } as never) as { status: number; json: () => Promise<unknown> };
    const body = await res.json() as { processed: number; errors: { error: string }[] };

    expect(res.status).toBe(200);
    expect(body.processed).toBe(0);
    expect(body.errors[0].error).toBe('db unavailable');
    expect(mockChargeSubscription).not.toHaveBeenCalled();
  });
});
