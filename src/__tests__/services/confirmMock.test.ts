import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BL-CHAT-C4 — confirm-mock 결제확인 처리 범위 한정 (TDD)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 대상: src/routes/api/checkout/confirm-mock/+server.ts
 *
 * 결함: reservationIds가 body에 아예 전달되지 않으면(하위호환 fallback) 필터 없이
 *       해당 유저의 모든 status='hold' 예약을 조회해 전부 confirmed로 승인해버림.
 *
 * 승인된 수정 방향: reservationIds를 필수로 강제. 누락(null) 시 즉시 400 반환하고
 *       hold 전체조회 쿼리(Supabase admin client 생성 자체)가 실행되지 않아야 한다.
 *
 * 테스트 전략: 이 라우트는 locals.safeGetSession()에 의존하는 SvelteKit RequestHandler라
 *       순수 함수로 분리하지 않고, POST 핸들러를 직접 import해 locals/request를 모킹하는
 *       방식(옵션 b)을 택했다 — @supabase/supabase-js의 createClient와 $env/dynamic/private,
 *       $lib/env/supabasePublic을 vi.mock으로 대체해 실제 네트워크 호출 없이 쿼리 체인
 *       호출 여부(from/eq/in/rpc)를 스파이로 검증한다.
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

// vi.mock은 호이스팅되므로 mock 등록 이후 동적 import로 라우트 핸들러를 가져온다
const { POST } = await import('../../routes/api/checkout/confirm-mock/+server');

// ── 테스트용 Supabase admin 클라이언트 스텁 ───────────────────────────────────
type Hold = { id: number; reservation_code: string | null };

interface AdminStub {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  inFn: ReturnType<typeof vi.fn>;
}

// confirmResult: mark_reservation_payment_confirmed 응답의 data 값.
//   true(기본)  → 계약서명 이미 완료된 상태로 간주, 즉시 confirmed 전환
//   false       → 계약 미서명(Migration 284 게이팅) — hold 유지, 알림 미발송
function makeAdminStub(
  holds: Hold[] | null,
  fetchError: { message: string } | null = null,
  confirmResult: boolean = true,
): AdminStub {
  const inFn = vi.fn().mockResolvedValue({ data: holds, error: fetchError });
  const eq2Fn = vi.fn(() => ({ in: inFn }));
  const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
  const selectFn = vi.fn(() => ({ eq: eq1Fn }));
  const fromFn = vi.fn((table: string) => {
    if (table === 'rental_reservations') return { select: selectFn };
    throw new Error(`unexpected table: ${table}`);
  });
  const rpcFn = vi.fn((name: string) => {
    if (name === 'mark_reservation_payment_confirmed') {
      return Promise.resolve({ data: confirmResult, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return { from: fromFn, rpc: rpcFn, inFn };
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000099';

function makeLocals(hasSession = true) {
  return {
    safeGetSession: async () =>
      hasSession ? { session: { user: { id: TEST_USER_ID } } } : { session: null },
  };
}

function makeRequest(body: unknown) {
  return { json: async () => body } as Request;
}

beforeEach(() => {
  createClientMock.mockReset();
});

// ── ERROR — reservationIds 미전달 ─────────────────────────────────────────────
describe('POST /api/checkout/confirm-mock — Error: reservationIds 미전달', () => {
  it('RED: reservationIds가 body에 없으면 400 반환 + hold 전체조회 쿼리 미실행', async () => {
    const admin = makeAdminStub([{ id: 1, reservation_code: 'RSV-001' }]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({}), // reservationIds 필드 자체가 없음
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe('string');
    // 핵심 검증: admin 클라이언트 자체가 생성되지 않아야 함 → hold 전체조회가 물리적으로 불가능
    expect(createClientMock).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('RED: reservationIds가 null이면 400 반환', async () => {
    const admin = makeAdminStub([{ id: 1, reservation_code: 'RSV-001' }]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({ reservationIds: null }),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
  });
});

// ── EDGE — 빈 배열(명시적으로 선택된 예약 없음) ───────────────────────────────
describe('POST /api/checkout/confirm-mock — Edge: reservationIds 빈 배열', () => {
  it('reservationIds:[] → 기존 동작 유지 (confirmedCount:0, DB 쿼리 미실행)', async () => {
    const admin = makeAdminStub([]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({ reservationIds: [] }),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.confirmedCount).toBe(0);
    expect(json.confirmedReservations).toEqual([]);
    expect(admin.from).not.toHaveBeenCalled();
  });
});

// ── HAPPY — 특정 예약 ID만 지정 ────────────────────────────────────────────────
describe('POST /api/checkout/confirm-mock — Happy: 지정된 예약만 승인', () => {
  it('reservationIds:[특정ID] → 해당 건만 조회·승인, 무관한 hold 예약은 쿼리에 섞이지 않음', async () => {
    const admin = makeAdminStub([{ id: 5, reservation_code: 'RSV-005' }]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({ reservationIds: [5] }),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.confirmedCount).toBe(1);
    expect(json.confirmedReservations).toEqual([{ id: 5, reservationCode: 'RSV-005' }]);

    // 필터 쿼리가 정확히 요청된 ID 배열로만 호출됐는지 검증 (전체조회 아님)
    expect(admin.inFn).toHaveBeenCalledWith('id', [5]);
    expect(admin.inFn).toHaveBeenCalledTimes(1);

    // 승인 RPC가 지정된 건에 대해서만 호출됨 — Migration 284: 계약서명 게이팅 RPC 경유
    // (update_reservation_status 직접 호출 아님)
    expect(admin.rpc).toHaveBeenCalledWith('mark_reservation_payment_confirmed', {
      p_reservation_id: 5,
    });
    // 상담채팅 승인 알림 — 예약 건별 개별 호출이 아닌, 확정된 건 전체를 배열로 묶어
    // 단일 RPC(send_rental_chat_notification_batch) 1회만 호출됨(Migration 275, 2026-08-17)
    expect(admin.rpc).toHaveBeenCalledWith('send_rental_chat_notification_batch', {
      p_reservation_ids: [5],
      p_notify_type: 'reservation_approval',
    });
    expect(
      admin.rpc.mock.calls.filter((call: unknown[]) => call[0] === 'send_rental_chat_notification_batch')
    ).toHaveLength(1);
  });
});

// ── HAPPY — 2건 이상 동시 승인 시 통합 알림 단일 호출 (2026-08-17 정책 변경) ──────
describe('POST /api/checkout/confirm-mock — Happy: 2건 이상 동시 승인 → 통합 알림 1회', () => {
  it('reservationIds:[다건] → 알림 RPC가 예약 건별이 아닌 배치로 정확히 1회만 호출됨', async () => {
    const admin = makeAdminStub([
      { id: 5, reservation_code: 'RSV-005' },
      { id: 6, reservation_code: 'RSV-006' },
    ]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({ reservationIds: [5, 6] }),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.confirmedCount).toBe(2);

    const batchCalls = admin.rpc.mock.calls.filter(
      (call: unknown[]) => call[0] === 'send_rental_chat_notification_batch'
    );
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0][1]).toEqual({
      p_reservation_ids: [5, 6],
      p_notify_type: 'reservation_approval',
    });

    // 예약 건별 개별 알림 RPC는 더 이상 호출되지 않아야 함
    const perItemCalls = admin.rpc.mock.calls.filter(
      (call: unknown[]) => call[0] === 'send_rental_chat_notification'
    );
    expect(perItemCalls).toHaveLength(0);
  });
});

// ── EDGE — 계약서 미서명 게이팅 (Migration 284, 2026-08-17) ──────────────────────
describe('POST /api/checkout/confirm-mock — Edge: 계약서 미서명(mark_reservation_payment_confirmed=false)', () => {
  it('계약서명이 안 된 예약은 hold 유지 — confirmedReservations 비어있고 배치알림 RPC 미호출', async () => {
    const admin = makeAdminStub([{ id: 7, reservation_code: 'RSV-007' }], null, false);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(),
      request: makeRequest({ reservationIds: [7] }),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.confirmedCount).toBe(0);
    expect(json.confirmedReservations).toEqual([]);

    expect(admin.rpc).toHaveBeenCalledWith('mark_reservation_payment_confirmed', {
      p_reservation_id: 7,
    });

    const batchCalls = admin.rpc.mock.calls.filter(
      (call: unknown[]) => call[0] === 'send_rental_chat_notification_batch'
    );
    expect(batchCalls).toHaveLength(0);
  });
});

// ── 인증 가드 (기존 동작 회귀 방지) ────────────────────────────────────────────
describe('POST /api/checkout/confirm-mock — 세션 없음', () => {
  it('세션 없으면 401 반환, DB 접근 없음', async () => {
    const admin = makeAdminStub([]);
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      locals: makeLocals(false),
      request: makeRequest({ reservationIds: [5] }),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
