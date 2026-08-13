import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P8B-4 TDD: 계약서 양식 발행자 서명 필수 플래그 + 강제 검증
 *
 * 완료기준:
 *   - requires_issuer_signature = true인 양식으로 발행 시도 시 발행자 서명 없으면 서버에서 차단
 *   - requires_issuer_signature = false이거나 이미 발행자 서명이 있으면 정상 발송
 */

vi.mock('@sveltejs/kit', () => ({
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

vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: vi.fn().mockReturnValue(true),
}));

vi.mock('$lib/contract-signature/auditLog', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// checkIssuerSignatureRequired — 발행자 서명 필수 여부 검증 헬퍼
// P8B-4에서 send-chat endpoint에 추가되는 검증 로직을 단위 테스트로 고정

describe('발행자 서명 필수 플래그 검증 — P8B-4', () => {
  it('requires_issuer_signature=true이고 발행자 서명이 없으면 차단된다', async () => {
    const { checkIssuerSignatureRequired } = await import(
      '../../lib/contract-signature/issuerSignatureCheck.js'
    );

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'contracts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { template_id: 'tmpl-1' },
            }),
          };
        }
        if (table === 'contract_templates') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { requires_issuer_signature: true }, // 필수 플래그 ON
            }),
          };
        }
        if (table === 'contract_issuer_signatures') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null, // 발행자 서명 없음
            }),
          };
        }
        return {};
      }),
    };

    const result = await checkIssuerSignatureRequired(
      mockAdmin as unknown as Parameters<typeof checkIssuerSignatureRequired>[0],
      'contract-1',
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('발행자');
  });

  it('requires_issuer_signature=true이지만 이미 발행자 서명이 있으면 통과한다', async () => {
    const { checkIssuerSignatureRequired } = await import(
      '../../lib/contract-signature/issuerSignatureCheck.js'
    );

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'contracts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { template_id: 'tmpl-1' },
            }),
          };
        }
        if (table === 'contract_templates') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { requires_issuer_signature: true }, // 필수 플래그 ON
            }),
          };
        }
        if (table === 'contract_issuer_signatures') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'sig-existing' }, // 발행자 서명 있음
            }),
          };
        }
        return {};
      }),
    };

    const result = await checkIssuerSignatureRequired(
      mockAdmin as unknown as Parameters<typeof checkIssuerSignatureRequired>[0],
      'contract-1',
    );
    expect(result.blocked).toBe(false);
  });

  it('requires_issuer_signature=false이면 서명 없어도 통과한다', async () => {
    const { checkIssuerSignatureRequired } = await import(
      '../../lib/contract-signature/issuerSignatureCheck.js'
    );

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'contracts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { template_id: 'tmpl-1' },
            }),
          };
        }
        if (table === 'contract_templates') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { requires_issuer_signature: false }, // 필수 플래그 OFF
            }),
          };
        }
        return {};
      }),
    };

    const result = await checkIssuerSignatureRequired(
      mockAdmin as unknown as Parameters<typeof checkIssuerSignatureRequired>[0],
      'contract-1',
    );
    expect(result.blocked).toBe(false);
  });

  it('template_id가 없는 계약(템플릿 없음)은 필수 체크 스킵 — 통과', async () => {
    const { checkIssuerSignatureRequired } = await import(
      '../../lib/contract-signature/issuerSignatureCheck.js'
    );

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'contracts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { template_id: null }, // 템플릿 없음
            }),
          };
        }
        return {};
      }),
    };

    const result = await checkIssuerSignatureRequired(
      mockAdmin as unknown as Parameters<typeof checkIssuerSignatureRequired>[0],
      'contract-1',
    );
    expect(result.blocked).toBe(false);
  });
});
