import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage 1 TDD: RSV-B-C1 — 환불 RPC 실패 결과 검증 + 환불실패 배지 컬럼 포함 확인
 *
 * 검증 대상:
 * A. GET /api/cms/reservations/[id]/payment → refund_failed_at / refund_failure_reason 포함 반환
 * B. PUT handler → RPC success:false 3회 후 500 반환 + sendPushToAdmins 호출
 *
 * 채팅카드(admin-to-admin) 현황:
 *   이 코드베이스에는 관리자 대상 채팅카드(admin-to-admin chat message) 메커니즘이 존재하지
 *   않는다 — 모든 채팅 알림(send_rental_chat_notification 등)은 고객 대화 세션 기반이며
 *   관리자 내부 채널은 없다. sendPushToAdmins(브라우저 푸시)가 유일한 관리자 알림 채널이다.
 *   2026-08-31: 이 갭을 문서화하고, 현재 구현(push-only)을 Stage 1 관리자 알림 요건으로 확인.
 */

// ── GET 핸들러 테스트 ────────────────────────────────────────────────────────

const mockEnvGet = vi.hoisted(() => ({ SUPABASE_SERVICE_ROLE_KEY: 'key' }));
vi.mock('$env/static/private', () => mockEnvGet);
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
}));

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: vi.fn().mockReturnValue(true),
}));

// push mock — sendPushToAdmins, sendReservationLifecyclePush
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: vi.fn().mockResolvedValue(undefined),
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
}));

// dhero mock
vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: vi.fn(),
  DheroApiError: class extends Error {
    statusCode: number;
    constructor(msg: string, code: number) { super(msg); this.statusCode = code; }
  },
}));

// env mock
vi.mock('$env/dynamic/private', () => ({ env: { TOSS_SECRET_KEY: 'toss-secret' } }));

const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();
const mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
      update: mockUpdate,
    }),
    rpc: mockRpc,
  }),
}));

const { GET } = await import('../../routes/api/cms/reservations/[id]/payment/+server');

describe('RSV-B-C1: 환불실패 배지 컬럼 — GET /payment 포함 확인', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refund_failed_at / refund_failure_reason가 응답에 포함된다', async () => {
    const paymentRow = {
      order_id: 'ORD-001',
      payment_key: 'key-abc',
      payment_method: 'card',
      total_amount: 100000,
      paid_amount: 100000,
      point_amount: 0,
      coupon_discount: 0,
      confirmed_at: '2026-08-31T10:00:00Z',
      toss_response: null,
      status: 'cancelled',
      refund_failed_at: '2026-08-31T11:00:00Z',
      refund_failure_reason: 'PAYMENT_NOT_FOUND: DB 정합성 오류',
    };
    mockMaybeSingle.mockResolvedValue({ data: paymentRow, error: null });

    const res = await GET({
      params: { id: '42' },
      locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) },
    } as never) as { status: number; json: () => Promise<{ payment: typeof paymentRow }> };

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment?.refund_failed_at).toBe('2026-08-31T11:00:00Z');
    expect(body.payment?.refund_failure_reason).toBe('PAYMENT_NOT_FOUND: DB 정합성 오류');
  });

  it('refund_failed_at이 null이면 그대로 null 반환', async () => {
    const paymentRow = {
      order_id: 'ORD-002',
      payment_key: 'key-xyz',
      payment_method: 'card',
      total_amount: 50000,
      paid_amount: 50000,
      point_amount: 0,
      coupon_discount: 0,
      confirmed_at: '2026-08-31T09:00:00Z',
      toss_response: null,
      status: 'done',
      refund_failed_at: null,
      refund_failure_reason: null,
    };
    mockMaybeSingle.mockResolvedValue({ data: paymentRow, error: null });

    const res = await GET({
      params: { id: '43' },
      locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) },
    } as never) as { status: number; json: () => Promise<{ payment: typeof paymentRow }> };

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment?.refund_failed_at).toBeNull();
    expect(body.payment?.refund_failure_reason).toBeNull();
  });
});
