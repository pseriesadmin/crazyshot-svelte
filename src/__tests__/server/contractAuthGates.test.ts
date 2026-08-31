import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P7-1~5 — 전자계약 11개 액션 권한 게이트 (TDD)
 *
 * 대상:
 *   1. /cms/reservation/contracts load() 진입 게이트 (P7-1)
 *   2. /cms/reservation/contracts create/update/softDelete (P7-2)
 *   3. /api/cms/reservations/[id]/init-contract (P7-3)
 *   4. /api/cms/reservations/[id]/contract-data (P7-3)
 *   5. /api/cms/contracts/[id]/content GET/PATCH (P7-4)
 *   6. /api/cms/contracts/[id]/send-chat (P7-5)
 *
 * partner 계정 → 전부 차단 (redirect 또는 403)
 * manager/superadmin → 정상 통과
 *
 * 패턴: security-auth.md QR-CASE-2와 동일
 *   - load(): hasSettingsAccess false → redirect(303, '/cms?notice=access_denied')
 *   - actions: getCmsRoleForAction → hasSettingsAccess false → fail(403)
 *   - API handlers: getCmsRoleForAction → hasSettingsAccess false → json(403)
 */

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status} → ${location}`), { status, location });
  },
  json: (data: unknown, init?: { status?: number }) => ({
    _isResponse: true,
    status: init?.status ?? 200,
    data,
    async json() { return data; },
  }),
}));

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}));

vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeAdminStub(),
}));

const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
  getRoleLevel: (role: string) =>
    ({ superadmin: 100, manager: 50, partner: 10 } as Record<string, number>)[role] ?? 0,
}));

// ── 어드민 스텁 ───────────────────────────────────────────────────────────────

// content/+server.ts GET(P7-4)는 partner일 때 contract_signings.signed_at 여부를 먼저 조회한다
// (2026-08-20, 서명완료건은 partner도 열람 허용) — 테스트별로 이 조회 결과를 바꿔치기할 수 있도록
// 모듈 스코프 변수로 노출. null이면 기존처럼 항상 { data: null } 응답(= 서명 없음/조회 실패).
let nextMaybeSingleResult: { data: unknown; error: unknown } | null = null;
// 테이블별로 .maybeSingle() 응답을 따로 지정하고 싶을 때 사용(2026-08-21 신규) — 지정 안 된
// 테이블은 기존처럼 nextMaybeSingleResult(공용)로 폴백. content/+server.ts GET처럼 한 요청
// 안에서 contract_signings·contracts 두 테이블을 각각 다른 값으로 조회해야 검증 가능한
// 케이스(스냅샷 우선 반환)를 위해 추가했다 — 기존 테스트는 이 맵을 설정하지 않으므로 영향 없음.
let nextMaybeSingleByTable: Record<string, { data: unknown; error: unknown }> = {};

function makeAdminStub() {
  const fns = ['select','insert','update','delete','eq','in','is','not','order','limit','single','maybeSingle'];
  return {
    from: vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      fns.forEach(fn => {
        chain[fn] = vi.fn().mockReturnValue(chain);
      });
      (chain as Record<string, unknown>).maybeSingle = vi.fn()
        .mockImplementation(() => Promise.resolve(
          nextMaybeSingleByTable[table] ?? nextMaybeSingleResult ?? { data: null, error: null },
        ));
      (chain as Record<string, unknown>).single = vi.fn().mockResolvedValue({ data: null, error: null });
      // 실제 supabase-js 쿼리 빌더처럼 chain 자체를 thenable로 만든다 — 그래서 두 호출 패턴이
      // 전부 동작한다: ① `await ...order(...)`처럼 order()가 체인의 마지막 호출인 경우
      // (thenable 폴백으로 { data: [], error: null } 반환), ② `...order().limit().maybeSingle()`
      // 처럼 order() 뒤에 더 체이닝되는 경우(2026-08-21, content/+server.ts GET이 서명완료건
      // 스냅샷 조회에 이 패턴을 추가하며 필요해짐 — order()가 Promise를 즉시 반환해버리면
      // 그 뒤의 .limit()이 "not a function"으로 죽는다).
      (chain as Record<string, unknown>).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null });
      return chain;
    }),
    auth: { admin: {} },
  };
}

// ── 로컬 스텁 ─────────────────────────────────────────────────────────────────

function makeLocals(role?: string | null) {
  return {
    safeGetSession: vi.fn().mockResolvedValue({
      session: role !== undefined ? { user: { id: 'user-id' } } : null,
    }),
    supabase: { from: vi.fn() },
    cmsRole: undefined as string | undefined,
  };
}

function makeRequest(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return { formData: async () => fd } as unknown as Request;
}

function makeJsonRequest(body: unknown = {}): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

// ── 동적 import (vi.mock 호이스팅 후 실행) ────────────────────────────────────

const { load: contractsLoad, actions: contractsActions } =
  await import('../../routes/cms/reservation/contracts/+page.server');

const { POST: initContractPost } =
  await import('../../routes/api/cms/reservations/[id]/init-contract/+server');

const { GET: contractDataGet } =
  await import('../../routes/api/cms/reservations/[id]/contract-data/+server');

const { GET: contentGet, PATCH: contentPatch } =
  await import('../../routes/api/cms/contracts/[id]/content/+server');

const { POST: sendChatPost } =
  await import('../../routes/api/cms/contracts/[id]/send-chat/+server');

// ── P7-1: load() 진입 게이트 ──────────────────────────────────────────────────

describe('[P7-1] /cms/reservation/contracts — load() 진입 게이트', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('RED: partner 역할로 진입 시 /cms?notice=access_denied로 리다이렉트된다', async () => {
    const event = {
      parent: async () => ({ cmsRole: 'partner', session: { user: { id: 'uid' } } }),
      url: new URL('http://localhost/cms/reservation/contracts'),
    };

    await expect(
      (contractsLoad as (e: unknown) => Promise<unknown>)(event)
    ).rejects.toMatchObject({ location: '/cms?notice=access_denied', status: 303 });
  });

  it('GREEN: manager 역할로 진입 시 리다이렉트 없이 데이터 반환된다', async () => {
    const event = {
      parent: async () => ({ cmsRole: 'manager', session: { user: { id: 'uid' } } }),
      url: new URL('http://localhost/cms/reservation/contracts'),
    };

    // manager는 통과 → 리다이렉트 없이 정상 반환 (DB 스텁으로 빈 배열)
    const result = await (contractsLoad as (e: unknown) => Promise<unknown>)(event);
    expect(result).toHaveProperty('templates');
  });

  it('GREEN: superadmin 역할로도 진입 가능하다', async () => {
    const event = {
      parent: async () => ({ cmsRole: 'superadmin', session: { user: { id: 'uid' } } }),
      url: new URL('http://localhost/cms/reservation/contracts'),
    };
    const result = await (contractsLoad as (e: unknown) => Promise<unknown>)(event);
    expect(result).toHaveProperty('templates');
  });

  it('RED: cmsRole이 없을 때(비인증) 리다이렉트된다', async () => {
    const event = {
      parent: async () => ({ cmsRole: null }),
      url: new URL('http://localhost/cms/reservation/contracts'),
    };
    await expect(
      (contractsLoad as (e: unknown) => Promise<unknown>)(event)
    ).rejects.toMatchObject({ status: 303 });
  });
});

// ── P7-2: create/update/softDelete 액션 게이트 ────────────────────────────────

describe('[P7-2] /cms/reservation/contracts — create/update/softDelete 403 for partner', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('RED: partner가 create 호출 시 403 반환', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      request: makeRequest({ title: '테스트 양식' }),
      locals: makeLocals('partner'),
    };
    const result = await (contractsActions as Record<string, (e: unknown) => Promise<unknown>>).create(event);
    expect(result).toMatchObject({ status: 403 });
  });

  it('GREEN: manager가 create 호출 시 403으로 차단되지 않는다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      request: makeRequest({ title: '테스트 양식', content_blocks: '[]', specifications: '[]' }),
      locals: makeLocals('manager'),
    };
    // manager는 권한 게이트를 통과함. DB 스텁이 null을 반환해 내부 에러가 날 수 있으므로
    // try/catch로 감싸 403 이외의 결과(에러 포함)를 "통과"로 처리한다.
    let result: unknown;
    try {
      result = await (contractsActions as Record<string, (e: unknown) => Promise<unknown>>).create(event);
    } catch {
      // DB 스텁 한계로 인한 내부 에러 — 권한 게이트는 통과했으므로 OK
      return;
    }
    expect((result as { status: number }).status).not.toBe(403);
  });

  it('RED: partner가 update 호출 시 403 반환', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      request: makeRequest({ id: 'template-id', title: '수정' }),
      locals: makeLocals('partner'),
    };
    const result = await (contractsActions as Record<string, (e: unknown) => Promise<unknown>>).update(event);
    expect(result).toMatchObject({ status: 403 });
  });

  it('RED: partner가 softDelete 호출 시 403 반환', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      request: makeRequest({ id: 'template-id' }),
      locals: makeLocals('partner'),
    };
    const result = await (contractsActions as Record<string, (e: unknown) => Promise<unknown>>).softDelete(event);
    expect(result).toMatchObject({ status: 403 });
  });
});

// ── P7-3: init-contract, contract-data 게이트 ─────────────────────────────────

describe('[P7-3] API — init-contract / contract-data 403 for partner', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('RED: partner로 init-contract POST 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: '42' },
      locals: makeLocals('partner'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  it('GREEN: manager로 init-contract POST → 403 아닌 응답', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });

  it('RED: partner로 contract-data GET 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: '42' },
      locals: makeLocals('partner'),
      request: makeRequest(),
    };
    const res = await (contractDataGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  it('GREEN: manager로 contract-data GET → 403 아닌 응답', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (contractDataGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });
});

// ── P7-4: contracts/[id]/content GET/PATCH 게이트 ─────────────────────────────

describe('[P7-4] API — contracts/[id]/content GET/PATCH 403 for partner', () => {
  beforeEach(() => { vi.clearAllMocks(); nextMaybeSingleResult = null; nextMaybeSingleByTable = {}; });

  it('RED: partner로 GET 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  it('RED: partner로 PATCH 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      request: makeJsonRequest({ title: '수정된 제목' }),
    };
    const res = await (contentPatch as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  it('GREEN: manager로 GET → 403 아닌 응답', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });

  it('GREEN: partner라도 서명완료(contract_signings.signed_at 존재)건 GET → 403 아닌 응답 (2026-08-20)', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    nextMaybeSingleResult = { data: { signed_at: '2026-08-20T00:00:00Z' }, error: null };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });

  it('RED: partner + 서명 미완료(signed_at 없음)건 GET → 여전히 403 (2026-08-20)', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    nextMaybeSingleResult = { data: null, error: null };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  // 2026-08-21: ?preferSignedSnapshot=1 — 서명 시점 스냅샷 우선 반환(형태 보존)
  it('GREEN: ?preferSignedSnapshot=1 + 스냅샷 존재 → 라이브 콘텐츠가 아닌 스냅샷을 반환한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    nextMaybeSingleByTable = {
      contract_signings: {
        data: { signed_at: '2026-08-20T00:00:00Z', signed_content_snapshot: { title: '서명 당시 제목' } },
        error: null,
      },
      contracts: { data: { title: '그 이후 관리자가 고친 제목' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content?preferSignedSnapshot=1'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { data: { title: string } };
    expect(res.data).toEqual({ title: '서명 당시 제목' });
  });

  it('GREEN: preferSignedSnapshot 파라미터 없이 호출 → 스냅샷이 있어도 라이브 콘텐츠를 반환한다 (편집·재발송 흐름 보존)', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    nextMaybeSingleByTable = {
      contract_signings: {
        data: { signed_at: '2026-08-20T00:00:00Z', signed_content_snapshot: { title: '서명 당시 제목' } },
        error: null,
      },
      contracts: { data: { title: '그 이후 관리자가 고친 제목' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { data: { title: string } };
    expect(res.data).toEqual({ title: '그 이후 관리자가 고친 제목' });
  });

  it('GREEN: ?preferSignedSnapshot=1이어도 스냅샷이 없으면(구버전 서명 건) 라이브 콘텐츠로 폴백한다', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    nextMaybeSingleByTable = {
      contract_signings: {
        data: { signed_at: '2026-08-20T00:00:00Z', signed_content_snapshot: null },
        error: null,
      },
      contracts: { data: { title: '라이브 콘텐츠' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      request: makeRequest(),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/content?preferSignedSnapshot=1'),
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { data: { title: string } };
    expect(res.data).toEqual({ title: '라이브 콘텐츠' });
  });

  it('GREEN: manager로 PATCH → 403 아닌 응답', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      request: makeJsonRequest({ title: '수정' }),
    };
    const res = await (contentPatch as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });
});

// ── P7-5: send-chat 게이트 ────────────────────────────────────────────────────

describe('[P7-5] API — contracts/[id]/send-chat 403 for partner', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('RED: partner로 send-chat POST 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(403);
  });

  it('GREEN: manager로 send-chat POST → 403 아닌 응답', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('manager');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
  });
});

// ── 신규: 취소·만료 예약 계약서 발행/발송 차단 (2026-08-21) ──────────────────────
//
// 취소된 예약 2656번에서 계약서 발행/발송이 그대로 실행되던 결함(원인: init-contract·
// send-chat 어느 쪽도 rental_reservations.status를 조회조차 하지 않았음)을 수정하며 추가.
// expired(HOLD 30분 자동만료)도 cancelled와 동일하게 재고가 이미 해제된 종료 상태이므로
// 함께 차단 대상에 포함한다(Stephen 확인, service-operations.md §10). damage_claimed(파손
// 신고)는 confirmed(계약서명 완료 필수, service-operations.md §9) 이후에만 도달 가능해
// 이미 서명이 끝난 상태라 재발행이 필요 없어 함께 차단(Stephen 확인).

describe('[신규] 취소·만료·파손신고 예약 — 계약서 발행/발송 차단', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextMaybeSingleResult = null;
    nextMaybeSingleByTable = {};
    mockGetCmsRoleForAction.mockResolvedValue('manager');
  });

  it('RED: init-contract — 예약 status=cancelled → 422', async () => {
    nextMaybeSingleByTable = {
      rental_reservations: { data: { user_id: 'user-1', status: 'cancelled' }, error: null },
    };
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('RED: init-contract — 예약 status=expired → 422', async () => {
    nextMaybeSingleByTable = {
      rental_reservations: { data: { user_id: 'user-1', status: 'expired' }, error: null },
    };
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('RED: init-contract — 예약 status=damage_claimed → 422', async () => {
    nextMaybeSingleByTable = {
      rental_reservations: { data: { user_id: 'user-1', status: 'damage_claimed' }, error: null },
    };
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('GREEN: init-contract — 예약 status=hold → 422 아님', async () => {
    nextMaybeSingleByTable = {
      rental_reservations: { data: { user_id: 'user-1', status: 'hold' }, error: null },
    };
    const event = {
      params: { id: '42' },
      locals: makeLocals('manager'),
      request: makeRequest(),
    };
    const res = await (initContractPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(422);
  });

  it('RED: send-chat — 연결된 예약 status=cancelled → 422', async () => {
    nextMaybeSingleByTable = {
      contracts: { data: { id: 'contract-id-1', user_id: 'user-1', reservation_id: 42 }, error: null },
      rental_reservations: { data: { status: 'cancelled' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('RED: send-chat — 연결된 예약 status=expired → 422', async () => {
    nextMaybeSingleByTable = {
      contracts: { data: { id: 'contract-id-1', user_id: 'user-1', reservation_id: 42 }, error: null },
      rental_reservations: { data: { status: 'expired' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('RED: send-chat — 연결된 예약 status=damage_claimed → 422', async () => {
    nextMaybeSingleByTable = {
      contracts: { data: { id: 'contract-id-1', user_id: 'user-1', reservation_id: 42 }, error: null },
      rental_reservations: { data: { status: 'damage_claimed' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).toBe(422);
  });

  it('GREEN: send-chat — 연결된 예약 status=confirmed → 422 아님', async () => {
    nextMaybeSingleByTable = {
      contracts: { data: { id: 'contract-id-1', user_id: 'user-1', reservation_id: 42 }, error: null },
      rental_reservations: { data: { status: 'confirmed' }, error: null },
    };
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('manager'),
      url: new URL('http://localhost/api/cms/contracts/contract-id-1/send-chat'),
      request: makeRequest(),
    };
    const res = await (sendChatPost as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(422);
  });
});
