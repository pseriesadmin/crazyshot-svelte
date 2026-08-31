import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RSV-B-B4 TDD: 운송장 번호 저장 성공 시 채팅카드+푸시 발송
 *
 * QA 지적(2026-08-31): tracking_notify의 "수신측" 배선(RPC CASE 분기·push.ts 문구·ActionCard
 * 타입)은 전부 존재했으나, 정작 이를 호출하는 지점(tracking/+server.ts PATCH)이 빠져 있어
 * 운송장 번호를 저장해도 고객에게 아무 알림도 나가지 않는 완전한 no-op이었다.
 *
 * 수정: update_reservation_tracking RPC 성공 직후, send_rental_chat_notification(채팅카드)과
 * sendReservationLifecyclePush(브라우저 푸시) 둘 다 fail-soft로 호출한다(service-operations.md
 * §15 — 채팅카드와 브라우저 푸시는 별개 시스템이라 반드시 세트로 호출해야 함).
 *
 * EC-1: 저장 성공 → 채팅카드 RPC + 푸시 함수 둘 다 호출됨(notify_type='tracking_notify')
 * EC-2: 알림 발송 실패해도(fail-soft) 저장 자체의 200 응답에는 영향 없음
 */

const mockEnv = vi.hoisted(() => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }));
vi.mock('$env/static/private', () => mockEnv);
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
  error: (status: number, message: string) => {
    const e = new Error(message) as Error & { status: number };
    e.status = status;
    throw e;
  },
}));

const mockAdminRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockAdminRpc, from: vi.fn() }),
}));

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

const mockPush = vi.fn();
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: (...args: unknown[]) => mockPush(...args),
}));

const { PATCH } = await import('../../routes/api/cms/reservations/[id]/tracking/+server');

function makeLocals(rpcResult: { error: unknown } = { error: null }) {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-1' } } }),
    supabase: { rpc: vi.fn().mockResolvedValue(rpcResult) },
  };
}

function makeRequest(body: Record<string, unknown>) {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

beforeEach(() => {
  mockAdminRpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  mockPush.mockReset().mockResolvedValue(undefined);
});

describe('PATCH /api/cms/reservations/[id]/tracking — RSV-B-B4 알림 발송', () => {
  it('EC-1: 저장 성공 시 채팅카드+푸시가 tracking_notify로 발송된다', async () => {
    const locals = makeLocals();
    const res = await PATCH({
      params:  { id: '123' },
      request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }),
      locals,
    } as never);

    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith('send_rental_chat_notification', {
      p_reservation_id: 123,
      p_notify_type:    'tracking_notify',
    });
    expect(mockPush).toHaveBeenCalledWith(expect.anything(), 123, 'tracking_notify');
  });

  it('EC-2: 채팅카드 RPC가 실패해도(fail-soft) 저장 응답은 200 그대로 유지된다', async () => {
    mockAdminRpc.mockRejectedValueOnce(new Error('notify rpc down'));
    const locals = makeLocals();
    const res = await PATCH({
      params:  { id: '123' },
      request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }),
      locals,
    } as never);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
