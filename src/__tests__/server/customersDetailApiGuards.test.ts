import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BND-02 회귀 방지 — /cms/customers/{addresses,chat-sessions,credit-audit,profile-settings,
 * rentals,subscriptions} 6개 GET 엔드포인트가 "CMS 역할 존재 여부"만 확인하고
 * hasSettingsAccess(manager+) 체크가 없어, partner 등급 계정이 직접 HTTP 호출로 고객 PII
 * (배송지·채팅상담이력·크레이지스코어·알림설정·대여이력·구독이력)를 조회할 수 있던 결함
 * (CMS 백오피스 전역 정밀검증 v3 STAGE 4에서 발견). 부모 페이지(/cms/customers)는 이미
 * hasSettingsAccess로 막혀있어 UI 경로로는 재현되지 않지만, 이 6개는 독립된 +server.ts라
 * 브라우저에서 직접 fetch하면 우회 가능했다 — 각 엔드포인트에 동일 가드를 추가했다.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}));

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
}));

// fetchCmsProfileByAuthId의 dual-schema 내부 로직은 별도 관심사 — 여기선 역할 게이트만
// 검증하므로 반환값을 직접 제어한다.
const mockFetchCmsProfileByAuthId = vi.fn();
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => mockFetchCmsProfileByAuthId(...args),
}));

type QueryResult = { data: unknown; error: unknown };

function makeChainable(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

let mockTables: Record<string, QueryResult> = {};
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: vi.fn((table: string) => makeChainable(mockTables[table] ?? { data: [], error: null })),
  }),
}));

// ── 동적 import (vi.mock 호이스팅 이후에 실행됨) ──────────────────────────────
const { GET: addressesGET } = await import('../../routes/cms/customers/addresses/+server');
const { GET: chatSessionsGET } = await import('../../routes/cms/customers/chat-sessions/+server');
const { GET: creditAuditGET } = await import('../../routes/cms/customers/credit-audit/+server');
const { GET: profileSettingsGET } = await import('../../routes/cms/customers/profile-settings/+server');
const { GET: rentalsGET } = await import('../../routes/cms/customers/rentals/+server');
const { GET: subscriptionsGET } = await import('../../routes/cms/customers/subscriptions/+server');

function makeEvent(role: string | null) {
  mockFetchCmsProfileByAuthId.mockResolvedValue(role ? { cms_role: role } : null);
  return {
    locals: {
      safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-uid' } } }),
      supabase: {},
    },
    url: new URL('https://test.local/x?userId=user-1'),
  } as unknown as Parameters<typeof addressesGET>[0];
}

type Handler = (e: unknown) => Promise<{ status: number; data: unknown }>;

const ROUTES: Array<{ name: string; handler: Handler; tables: Record<string, QueryResult> }> = [
  {
    name: 'addresses',
    handler: addressesGET as unknown as Handler,
    tables: { user_shipping_addresses: { data: [], error: null } },
  },
  {
    name: 'chat-sessions',
    handler: chatSessionsGET as unknown as Handler,
    tables: {
      user_profiles: { data: { user_id: 'auth-user-1' }, error: null },
      chat_sessions: { data: [], error: null },
    },
  },
  {
    name: 'credit-audit',
    handler: creditAuditGET as unknown as Handler,
    tables: { credit_score_audit: { data: [], error: null } },
  },
  {
    name: 'profile-settings',
    handler: profileSettingsGET as unknown as Handler,
    tables: { user_profiles: { data: {}, error: null } },
  },
  {
    name: 'rentals',
    handler: rentalsGET as unknown as Handler,
    tables: {
      user_profiles: { data: { user_id: 'auth-user-1' }, error: null },
      rental_reservations: { data: [], error: null },
    },
  },
  {
    name: 'subscriptions',
    handler: subscriptionsGET as unknown as Handler,
    tables: { user_subscriptions: { data: [], error: null } },
  },
];

describe('BND-02 — /cms/customers/* 6개 엔드포인트 hasSettingsAccess 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const route of ROUTES) {
    it(`${route.name}: partner 역할은 403(권한 없음)을 반환한다`, async () => {
      mockTables = route.tables;
      const result = await route.handler(makeEvent('partner'));
      expect(result).toMatchObject({ status: 403 });
    });

    it(`${route.name}: manager 역할은 차단되지 않는다(200 통과)`, async () => {
      mockTables = route.tables;
      const result = await route.handler(makeEvent('manager'));
      expect(result.status).not.toBe(403);
    });
  }
});
