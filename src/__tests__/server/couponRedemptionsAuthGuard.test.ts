import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CMS 전역 정밀검증 v6 — CRITICAL #1: 쿠폰 사용내역 API 권한우회
 *
 * 대상: src/routes/api/cms/coupons/[id]/redemptions/+server.ts (GET)
 * 현재 결함: getCmsRoleForAction(locals)로 "CMS 직원인가"만 확인하고
 *   hasSettingsAccess(cmsRole)로 "manager 이상인가"는 확인하지 않음 —
 *   partner 등급도 이 API를 직접 호출(화면 미경유)하면 고객 PII(이름·이메일)와
 *   실채번 쿠폰코드가 그대로 응답된다.
 *
 * RED 확인: 현재 코드는 partner 세션에 대해서도 200을 반환함 → 테스트 FAIL
 * GREEN 목표: cmsRole 없음 → 401 / hasSettingsAccess(cmsRole) === false → 403
 *
 * 참조: security-auth.md "표준 패턴 — getCmsRoleForAction + hasSettingsAccess",
 *   /cms/reservations/[id]/payment/+server.ts:92-95(동일 패턴 선례)
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}));

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}));

vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}));

const mockRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

const mockGetCmsRoleForAction = vi.fn();
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
}));

const { GET } = await import('../../routes/api/cms/coupons/[id]/redemptions/+server');

function makeEvent(cmsRoleValue: string | null) {
  mockGetCmsRoleForAction.mockResolvedValue(cmsRoleValue);
  return {
    params: { id: 'coupon-test-id' },
    locals: { cmsRole: cmsRoleValue ?? undefined },
  } as unknown as Parameters<typeof GET>[0];
}

describe('[CS2654-보완] 쿠폰 사용내역 API — 권한 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: [{
        user_coupon_id: 'uc-1',
        user_id: 'user-1',
        redeemed_code: 'CS-0001',
        used_at: '2026-09-01T00:00:00Z',
        user_name: '홍길동',
        user_email: 'hong@test.com',
        reservation_id: 1,
        reservation_status: 'confirmed',
      }],
      error: null,
    });
  });

  it('cmsRole 없음 → 401 반환', async () => {
    const result = (await GET(makeEvent(null))) as unknown as { status: number };
    expect(result.status).toBe(401);
  });

  it('RED → GREEN: partner 등급 → 403 반환해야 한다(현재는 200이 반환됨)', async () => {
    const result = (await GET(makeEvent('partner'))) as unknown as { status: number };
    expect(result.status).toBe(403);
  });

  it('manager 등급 → 200 반환 유지(회귀 없음)', async () => {
    const result = (await GET(makeEvent('manager'))) as unknown as { status: number };
    expect(result.status).toBe(200);
  });

  it('superadmin 등급 → 200 반환 유지(회귀 없음)', async () => {
    const result = (await GET(makeEvent('superadmin'))) as unknown as { status: number };
    expect(result.status).toBe(200);
  });
});
