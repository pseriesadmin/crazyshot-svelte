import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * reservation-rental-execution.md §0-3 — late-fee/pay-mock 채팅 세션 승격 결함 수정 (TDD)
 *
 * 결함: 연체료 결제완료 채팅 안내가 자체 인라인 세션조회(status IN ('open','pending'),
 *       context_type 필터 없음)를 갖고 있어 §3(결함B-2)·§5-2(coupon-gift)와 동일 계열의
 *       세션단절 버그를 가짐 + 세션이 전부 closed/부재면 신규 생성 폴백조차 없어 메시지가
 *       완전히 유실됨(coupon-gift보다 심각).
 *
 * 수정: find_or_create_general_chat_session RPC 경유로 교체(§3·§5-2와 동일 패턴).
 *
 * 테스트 전략: confirmMock.test.ts와 동일하게 POST 핸들러를 직접 import해 locals/request를
 *       모킹. validateLateFeeAccess·locals.supabase.rpc(pay_late_fee_mock)는 자체 검증
 *       대상이 아니므로(다른 파일 소관) 성공 고정값으로 모킹하고, 이번 수정의 핵심인
 *       "세션 조회는 반드시 find_or_create_general_chat_session RPC를 거친다"만 집중 검증.
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

const validateLateFeeAccessMock = vi.fn();
vi.mock('$lib/server/lateFeeUtils', () => ({
  validateLateFeeAccess: (...args: unknown[]) => validateLateFeeAccessMock(...args),
}));

const { POST } = await import('../../routes/api/checkout/late-fee/[id]/pay-mock/+server');

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';
const TEST_RESERVATION_ID = 777;
const TEST_LATE_FEE = {
  id: 'late-fee-uuid-test',
  reservation_id: TEST_RESERVATION_ID,
  fee_amount: 12000,
  hours_late: 3,
  is_paid: false,
};

interface AdminStub {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  insertFn: ReturnType<typeof vi.fn>;
}

function makeAdminStub(rpcResult: { data: unknown; error: unknown }): AdminStub {
  const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
  const fromFn = vi.fn((table: string) => {
    if (table === 'chat_messages') return { insert: insertFn };
    throw new Error(`unexpected table: ${table}`);
  });
  const rpcFn = vi.fn().mockResolvedValue(rpcResult);
  return { from: fromFn, rpc: rpcFn, insertFn };
}

function makeLocals(payRpcOk = true) {
  return {
    safeGetSession: async () => ({ session: { user: { id: TEST_USER_ID } } }),
    supabase: {
      rpc: vi.fn().mockResolvedValue(
        payRpcOk
          ? { data: { ok: true, fee_amount: TEST_LATE_FEE.fee_amount }, error: null }
          : { data: { ok: false, error: '이미 결제됨', status: 409 }, error: null }
      ),
    },
  };
}

function makeRequest() {
  return {} as Request;
}

beforeEach(() => {
  createClientMock.mockReset();
  validateLateFeeAccessMock.mockReset();
  validateLateFeeAccessMock.mockResolvedValue({ ok: true, lateFee: TEST_LATE_FEE });
});

describe('POST /api/checkout/late-fee/[id]/pay-mock — 채팅 세션 조회는 find_or_create_general_chat_session RPC 경유', () => {
  it('GREEN: 결제 성공 시 find_or_create_general_chat_session을 올바른 파라미터로 호출하고, 반환된 세션에 메시지를 삽입한다', async () => {
    const admin = makeAdminStub({ data: 'session-uuid-open', error: null });
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      params: { id: TEST_LATE_FEE.id },
      locals: makeLocals(true),
      request: makeRequest(),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // 핵심 검증: 자체 인라인 세션조회(.from('chat_sessions').select...in(['open','pending']))가
    // 아니라 find_or_create_general_chat_session RPC로 세션을 얻는다 — context_type 필터 +
    // pending/closed→open 승격 + 신규생성 폴백을 이 RPC가 전부 보장하므로 메시지 유실 없음.
    expect(admin.rpc).toHaveBeenCalledWith('find_or_create_general_chat_session', {
      p_user_id: TEST_USER_ID,
      p_reservation_id: TEST_RESERVATION_ID,
    });
    // chat_sessions 테이블을 직접 조회하지 않아야 함(RPC 경유로 완전히 대체됐음)
    expect(admin.from).not.toHaveBeenCalledWith('chat_sessions');

    expect(admin.insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'session-uuid-open',
        sender_type: 'admin',
        content: expect.stringContaining('연체료 결제가 완료됐습니다'),
      })
    );
  });

  it('GREEN: find_or_create_general_chat_session이 실패해도(RPC 에러) 결제 자체는 500으로 실패하지 않는다', async () => {
    const admin = makeAdminStub({ data: null, error: { message: 'rpc down' } });
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      params: { id: TEST_LATE_FEE.id },
      locals: makeLocals(true),
      request: makeRequest(),
    } as unknown as Parameters<typeof POST>[0]);

    const json = await res.json();
    // 채팅 안내는 부가 기능 — 세션 조회 실패가 결제 완료 응답 자체를 막지 않아야 함
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // 세션을 못 얻었으므로 메시지 삽입 자체가 시도되지 않아야 함(session_id 없이 삽입 금지)
    expect(admin.insertFn).not.toHaveBeenCalled();
  });

  it('세션 없음 없어도(신규 세션 생성 케이스) 정상적으로 새 세션 id에 메시지가 들어간다', async () => {
    // find_or_create_general_chat_session은 세션이 아예 없으면 신규 open 세션을 만들어 그
    // id를 반환한다(§0-3 — 기존 버그는 이 경우 메시지가 완전히 유실됐었음)
    const admin = makeAdminStub({ data: 'brand-new-session-uuid', error: null });
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      params: { id: TEST_LATE_FEE.id },
      locals: makeLocals(true),
      request: makeRequest(),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    expect(admin.insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'brand-new-session-uuid' })
    );
  });
});

describe('POST /api/checkout/late-fee/[id]/pay-mock — 인증/검증 가드(기존 동작 회귀 방지)', () => {
  it('세션 없으면 401, DB 접근 없음', async () => {
    const admin = makeAdminStub({ data: null, error: null });
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      params: { id: TEST_LATE_FEE.id },
      locals: { safeGetSession: async () => ({ session: null }), supabase: { rpc: vi.fn() } },
      request: makeRequest(),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('validateLateFeeAccess 실패(예: 이미 결제됨) → 해당 status 반환, 채팅 세션 로직 미실행', async () => {
    validateLateFeeAccessMock.mockResolvedValue({ ok: false, error: '이미 결제된 연체료입니다.', status: 409 });
    const admin = makeAdminStub({ data: 'session-uuid', error: null });
    createClientMock.mockReturnValue(admin);

    const res = await POST({
      params: { id: TEST_LATE_FEE.id },
      locals: makeLocals(true),
      request: makeRequest(),
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
