import { describe, it, expect, vi } from 'vitest';

/**
 * Stage 2 TDD: RSV-B-C2 — cancel_reservation_payment v_cancelled_ids 필터링
 *
 * 문제: Migration 384에서 PERFORM update_reservation_status(...)가 반환값을 버려
 *       completed/damage_claimed 예약도 취소 성공 여부와 무관하게 v_cancelled_ids에 포함됨.
 *
 * 수정: 새 migration에서 update_reservation_status 호출 후 실제 status 재조회,
 *       실제로 'cancelled'가 된 경우만 v_cancelled_ids에 포함.
 *
 * EC-2: completed 1건 + hold 1건 → hold만 v_cancelled_ids에 포함
 *       (환불(Toss 결제취소)은 주문 전체 그대로, 알림만 실제 전환된 예약으로 좁힘)
 *
 * NOTE: 이 테스트는 DB 레벨 RPC를 직접 테스트하기 어려워, 서버 핸들러(PUT payment)가
 *       cancelled_reservation_ids를 정확히 전달받아 알림 발송 여부를 결정하는지 검증.
 */

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

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

const mockSendPush = vi.fn().mockResolvedValue(undefined);
const mockSendLifecyclePush = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: (...args: unknown[]) => mockSendLifecyclePush(...args),
  sendPushToAdmins: (...args: unknown[]) => mockSendPush(...args),
}));
vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: vi.fn().mockResolvedValue(undefined),
  DheroApiError: class extends Error { statusCode = 0 },
}));
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: vi.fn().mockReturnValue(true),
}));

const { PUT } = await import('../../routes/api/cms/reservations/[id]/payment/+server');

function makeLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-uuid' } } }), supabase: {} };
}

function setupScenario(cancelledIds: number[]) {
  let ptCount = 0;
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
      ptCount++;
      if (ptCount === 1) {
        chain.maybeSingle.mockResolvedValue({ data: { payment_key: 'pk_123', status: 'done' }, error: null });
      } else {
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
    } else if (table === 'rental_reservations') {
      chain.maybeSingle.mockResolvedValue({ data: { status: 'hold', tracking_number: null }, error: null });
    } else {
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    }
    return chain;
  });

  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  mockRpc.mockResolvedValue({
    data: { success: true, cancelled_reservation_ids: cancelledIds },
    error: null,
  });
}

describe('RSV-B-C2: cancelled_reservation_ids 필터링 — 알림은 실제 전환된 예약만', () => {
  it('EC-2: completed(완료) 예약은 cancelled_reservation_ids에서 제외되어 알림 미발송', async () => {
    // RPC가 실제로 hold만 취소(completed는 상태전환 실패)한 결과를 반환
    // → hold 예약 ID(123)만 cancelled_ids에 포함, completed 예약 ID(456)는 미포함
    setupScenario([123]); // completed 456은 RPC가 이미 제외해서 반환

    const res = await PUT({
      params: { id: '123' },
      locals: makeLocals(),
      request: { json: vi.fn().mockResolvedValue({}) } as unknown as Request,
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json() as { cancelledIds?: number[] };
    // 알림 대상은 실제 전환된 123만
    expect(body.cancelledIds).toEqual([123]);
    // send_rental_chat_notification 호출 횟수 = 1 (123에 대해서만)
    const chatNotifyCalls = mockRpc.mock.calls.filter(
      (c: unknown[]) => (c[0] as string) === 'send_rental_chat_notification'
    );
    expect(chatNotifyCalls.length).toBe(1);
    expect((chatNotifyCalls[0][1] as { p_reservation_id: number }).p_reservation_id).toBe(123);
  });

  it('both completed and hold → RPC가 hold만 반환하면 알림도 hold만', async () => {
    setupScenario([789]); // 789만 실제 취소됨

    const res = await PUT({
      params: { id: '789' },
      locals: makeLocals(),
      request: { json: vi.fn().mockResolvedValue({}) } as unknown as Request,
      url: new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json() as { cancelledIds?: number[] };
    expect(body.cancelledIds).toEqual([789]);
  });
});
