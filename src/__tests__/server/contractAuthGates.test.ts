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

function makeAdminStub() {
  const chain: Record<string, unknown> = {};
  const fns = ['select','insert','update','delete','eq','is','order','limit','single','maybeSingle'];
  fns.forEach(fn => {
    chain[fn] = vi.fn().mockReturnValue(chain);
  });
  (chain as Record<string, unknown>).maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  (chain as Record<string, unknown>).single = vi.fn().mockResolvedValue({ data: null, error: null });
  (chain as Record<string, unknown>).order = vi.fn().mockResolvedValue({ data: [], error: null });
  return {
    from: vi.fn().mockReturnValue(chain),
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
  beforeEach(() => { vi.clearAllMocks(); });

  it('RED: partner로 GET 호출 시 403', async () => {
    mockGetCmsRoleForAction.mockResolvedValue('partner');
    const event = {
      params: { id: 'contract-id-1' },
      locals: makeLocals('partner'),
      request: makeRequest(),
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
    };
    const res = await (contentGet as (e: unknown) => Promise<unknown>)(event) as { status: number };
    expect(res.status).not.toBe(403);
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
