import { describe, it, expect, vi, beforeEach } from 'vitest';
// 1c: rental.reservation 메뉴 권한 게이트는 rentalMenuGuard.test.ts에서 따로 검증 — 여기서는 통과로 고정하고 핸들러 자체 로직만 본다
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null), requireAnyMenuAccessApi: vi.fn(async () => null), requireMenuAccessAction: vi.fn(async () => null) }))

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
// 직전 운송장 번호 조회(.from().select().eq().maybeSingle()) — 기본은 undefined 를 돌려줘 조회 실패(fail-open: 안내 발송)로 취급된다
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockAdminRpc, from: mockFrom }),
}));

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

const mockPush = vi.fn();
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: (...args: unknown[]) => mockPush(...args),
}));

const { PATCH, GET } = await import('../../routes/api/cms/reservations/[id]/tracking/+server');

function makeLocals(rpcResult: { error: unknown } = { error: null }) {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-1' } } }),
    supabase: { rpc: vi.fn().mockResolvedValue(rpcResult) },
  };
}

function makeRequest(body: Record<string, unknown>) {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

// 예약 행(.from('rental_reservations').select().eq().maybeSingle()) + 수령 방식 행(.from('rental_method_options').select().eq().is().maybeSingle()) 모의.
// 기본은 배송형('delivery', is_delivery_type=true) — 운송장 입력 허용 대상이다(2026-10-27: 배송형이 아닌 수령방식에는 운송장 개념이 없다).
function previousTracking(value: string | null, opts: { method?: string | null; deliveryType?: boolean } = {}) {
  const method = 'method' in opts ? opts.method : 'delivery';
  const deliveryType = opts.deliveryType ?? true;
  mockFrom.mockImplementation((table: string) =>
    table === 'rental_method_options'
      ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { is_delivery_type: deliveryType }, error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tracking_number: value, pickup_method: method }, error: null }) }) }) },
  );
}

beforeEach(() => {
  mockFrom.mockReset();
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

/**
 * 2026-10-27 (Stephen 지시): 운송장 안내 중복·빈값 방지
 * - 번호를 비운 채 저장하거나(빈 값), 이미 저장된 같은 번호를 다시 저장하면 고객에게 안내를 보내지 않는다.
 * - 앞뒤 공백은 서버가 지워 저장하며, 공백만 바뀐 같은 번호도 '같은 번호'로 본다.
 * - 직전 값을 읽지 못하면(조회 실패) 기존처럼 안내를 보낸다(fail-open — 안내 누락이 중복보다 위험).
 */
describe('PATCH /api/cms/reservations/[id]/tracking — 안내 중복·빈값 방지', () => {
  it('TN-1: 번호를 비워 저장하면 저장은 되지만 안내를 보내지 않는다', async () => {
    previousTracking('OLD-111');
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: '   ', courier_code: 'CJ' }), locals: makeLocals() } as never);
    const body = await res.json() as { success: boolean; notified: boolean };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.notified).toBe(false);
    expect(mockAdminRpc).not.toHaveBeenCalledWith('send_rental_chat_notification', expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('TN-2: 이미 저장된 같은 번호를 다시 저장하면 안내를 다시 보내지 않는다', async () => {
    previousTracking('ABC123');
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    const body = await res.json() as { notified: boolean };
    expect(res.status).toBe(200);
    expect(body.notified).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('TN-3: 앞뒤 공백만 다른 같은 번호도 같은 번호로 본다(저장 값은 공백 없이)', async () => {
    previousTracking('ABC123');
    const locals = makeLocals();
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: '  ABC123 ', courier_code: 'CJ' }), locals } as never);
    const body = await res.json() as { tracking_number: string; notified: boolean };
    expect(body.tracking_number).toBe('ABC123');
    expect(body.notified).toBe(false);
    expect(locals.supabase.rpc).toHaveBeenCalledWith('update_reservation_tracking', expect.objectContaining({ p_tracking_number: 'ABC123' }));
  });

  it('TN-4: 번호가 새로 등록되거나 바뀌면 안내를 보낸다 (앞 공백은 지워 저장)', async () => {
    previousTracking(null);
    const locals = makeLocals();
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: ' NEW-999', courier_code: 'CJ' }), locals } as never);
    const body = await res.json() as { tracking_number: string; notified: boolean };
    expect(body.tracking_number).toBe('NEW-999');
    expect(body.notified).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(expect.anything(), 123, 'tracking_notify');

    mockPush.mockClear();
    previousTracking('OLD-111');
    const res2 = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'NEW-999', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect((await res2.json() as { notified: boolean }).notified).toBe(true);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('TN-5: 직전 번호 조회가 실패하면 기존처럼 안내를 보낸다 (fail-open)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect((await res.json() as { notified: boolean }).notified).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(expect.anything(), 123, 'tracking_notify');
  });

  // ── sp3 검수 보완(2026-10-27, MINOR-4): 조회 순서·조회 오류·예약 없음·저장 실패 ──
  // 저장 호출이 "저장된 번호"를 실제로 바꾸는 상태 있는 모의로, 직전 번호를 저장 전에 읽는지(순서)를 고정한다.
  function statefulSetup(initial: string | null) {
    let stored: string | null = initial;
    mockFrom.mockImplementation((table: string) =>
      table === 'rental_method_options'
        ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { is_delivery_type: true }, error: null }) }) }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tracking_number: stored, pickup_method: 'delivery' }, error: null }) }) }) },
    );
    const rpc = vi.fn(async (_fn: string, args: { p_tracking_number: string | null }) => {
      stored = args.p_tracking_number;
      return { data: null, error: null };
    });
    return { locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-1' } } }), supabase: { rpc } } };
  }

  it('TN-6: 직전 번호는 저장 호출보다 먼저 읽는다 — 순서가 바뀌면 새 번호도 "같은 번호"로 오판해 안내가 사라진다', async () => {
    const { locals } = statefulSetup('OLD-111');
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'NEW-999', courier_code: 'CJ' }), locals } as never);
    expect((await res.json() as { notified: boolean }).notified).toBe(true);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(locals.supabase.rpc).toHaveBeenCalledWith('update_reservation_tracking', expect.objectContaining({ p_tracking_number: 'NEW-999' }));
  });

  it('TN-6b: 같은 번호 재저장은 상태 있는 모의에서도 안내하지 않는다', async () => {
    const { locals } = statefulSetup('SAME-1');
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'SAME-1', courier_code: 'CJ' }), locals } as never);
    expect((await res.json() as { notified: boolean }).notified).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('TN-7: 직전 번호 조회가 예외가 아니라 오류를 돌려줘도(fail-open) 안내를 보낸다', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'select failed' } }) }) }),
    });
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect((await res.json() as { notified: boolean }).notified).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(expect.anything(), 123, 'tracking_notify');
  });

  it('TN-8: 예약 행을 못 찾아 직전 번호를 알 수 없어도(fail-open) 안내를 보낸다', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect((await res.json() as { notified: boolean }).notified).toBe(true);
  });

  it('TN-9: 저장(RPC)이 실패하면 500 이고 고객 안내는 나가지 않는다', async () => {
    previousTracking(null);
    await expect(
      PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals({ error: { message: 'rpc failed' } }) } as never),
    ).rejects.toMatchObject({ status: 500 });
    expect(mockAdminRpc).not.toHaveBeenCalledWith('send_rental_chat_notification', expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-27 (Stephen 지시): 운송장 입력은 수령방식이 배송형(is_delivery_type)일 때만 — 서버 방어
 * 방문·무인보관함·퀵서비스에는 운송장이 없다. 번호를 넣으면 고객에게 잘못된 안내가 나가고(tracking_notify), 이미 운송장이 저장된 예약의
 * 취소·상태 동기화가 두발히어로로 흘러갈 수 있다. 기존 데이터는 건드리지 않는다(비우기·조회는 허용).
 *  TA-1  배송형이 아닌 수령방식에 번호를 저장하려 하면 400, 저장·안내 모두 없음
 *  TA-2  배송형이면 정상 저장·안내
 *  TA-3  배송형이 아니어도 번호를 비우는 저장(정리)은 허용, 안내 없음
 *  TA-4  수령방식이 비어 있는 예약도 번호 저장 거절
 *  TA-5  판정을 읽지 못하면(방식 행 없음·조회 오류) 기존처럼 저장(fail-open)
 *  TA-6  GET 은 tracking_applicable 로 화면에 알려 준다(true/false, 알 수 없으면 필드 생략)
 */
describe('운송장 입력은 배송형 수령방식에서만 (서버 방어)', () => {
  it('TA-1: 방문(배송형 아님)에 번호를 저장하려 하면 400이고 저장·안내가 없다', async () => {
    previousTracking(null, { method: 'visit', deliveryType: false });
    const locals = makeLocals();
    await expect(
      PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(locals.supabase.rpc).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalledWith('send_rental_chat_notification', expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('TA-2: 배송형이면 정상 저장되고 새 번호는 안내된다', async () => {
    previousTracking(null, { method: 'delivery', deliveryType: true });
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect(res.status).toBe(200);
    expect((await res.json() as { notified: boolean }).notified).toBe(true);
  });

  it('TA-3: 배송형이 아니어도 번호를 비우는 저장(정리)은 허용되고 안내는 없다', async () => {
    previousTracking('STRAY-1', { method: 'visit', deliveryType: false });
    const locals = makeLocals();
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: '', courier_code: '' }), locals } as never);
    expect(res.status).toBe(200);
    expect((await res.json() as { notified: boolean }).notified).toBe(false);
    expect(locals.supabase.rpc).toHaveBeenCalledWith('update_reservation_tracking', expect.objectContaining({ p_tracking_number: null }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('TA-4: 수령방식이 비어 있는 예약도 번호 저장은 거절된다', async () => {
    previousTracking(null, { method: null });
    await expect(
      PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('TA-5: 방식 행을 못 찾거나 조회가 실패하면 기존처럼 저장된다 (fail-open — 정상 택배 저장을 막지 않는다)', async () => {
    mockFrom.mockImplementation((table: string) =>
      table === 'rental_method_options'
        ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tracking_number: null, pickup_method: 'legacy-key' }, error: null }) }) }) },
    );
    const res = await PATCH({ params: { id: '123' }, request: makeRequest({ tracking_number: 'ABC123', courier_code: 'CJ' }), locals: makeLocals() } as never);
    expect(res.status).toBe(200);
  });

  it('TA-6: GET 은 tracking_applicable 로 화면에 알려 준다', async () => {
    const get = (id = '123') => GET({ params: { id }, locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'a' } } }) } } as never) as unknown as Promise<{ json(): Promise<Record<string, unknown>> }>;
    // GET 은 service_role 로 예약(tracking_number, courier_code, pickup_method)을 읽고 방식 행으로 배송형 여부를 판정한다
    const reservationRow = (method: string | null) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tracking_number: 'T1', courier_code: 'CJ', pickup_method: method }, error: null }) }) }) });
    const methodRow = (flag: boolean) => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { is_delivery_type: flag }, error: null }) }) }) }) });
    mockFrom.mockImplementation((t: string) => (t === 'rental_method_options' ? methodRow(true) : reservationRow('delivery')));
    expect((await (await get()).json()).tracking_applicable).toBe(true);
    mockFrom.mockImplementation((t: string) => (t === 'rental_method_options' ? methodRow(false) : reservationRow('visit')));
    const body = await (await get()).json();
    expect(body.tracking_applicable).toBe(false);
    expect(body.tracking_number).toBe('T1'); // 기존 값은 그대로 내려준다(정리·확인용)
    mockFrom.mockImplementation((t: string) => (t === 'rental_method_options' ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } : reservationRow('legacy')));
    expect('tracking_applicable' in (await (await get()).json())).toBe(false);
  });
});
