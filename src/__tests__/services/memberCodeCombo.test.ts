import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient } from '@supabase/supabase-js';

/**
 * /cms/customers '설정' — 회원코드 코드조합 기준설정 (TDD)
 * generate_member_code 확장 + bulk_reissue_member_codes — Migration 274
 *
 * ⚠️ 두 RPC 모두 REVOKE ALL ... GRANT service_role 전용 — adminClient(service role)로만 호출.
 *
 * 범위:
 *   - override 지정 시 그 접두어로 채번되는가
 *   - override 미지정 시 기존 B2C→BC/B2B→BB 하드코딩 그대로 유지되는가(하위호환 회귀 방지)
 *   - override가 빈 문자열이면 안전하게 기존 폴백으로 처리되는가
 *   - bulk_reissue_member_codes가 활성 고객 전원을 재발급하고 이력 로그에 old/new를 정확히 남기는가
 *   - bulk_reissue_member_codes에 빈/NULL 접두어를 넣으면 안전하게 거부되는가
 */

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const callGenerateMemberCode = async (
  p_member_type: string,
  p_use_yymm: boolean,
  p_category_code_override: string | null
): Promise<{ data: string | null; error: { message: string } | null }> => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');
  return (
    adminClient.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  )('generate_member_code', { p_member_type, p_use_yymm, p_category_code_override });
};

const callBulkReissue = async (
  p_prefix: string | null,
  p_reissued_by = 'vitest'
): Promise<{
  data: { success: boolean; reissued_count?: number; error?: string } | null;
  error: { message: string } | null;
}> => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');
  return (
    adminClient.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => Promise<{
      data: { success: boolean; reissued_count?: number; error?: string } | null;
      error: { message: string } | null;
    }>
  )('bulk_reissue_member_codes', { p_prefix, p_reissued_by });
};

describe('generate_member_code — 코드조합 override 확장', () => {
  it('RED: override 미지정 시 기존 B2C→CS+BC 하드코딩 형식 그대로 유지된다(회귀 방지)', async () => {
    const { data, error } = await callGenerateMemberCode('B2C', true, null);
    expect(error).toBeNull();
    // 순번은 3자리 "이상"(migration 277 — 1000 넘어가면 절단 없이 자릿수 자연 확장)이므로
    // 정확히 3자리로 고정하지 않는다. Stage의 실제 BC/이번달 카운터가 이미 1000을 넘겨
    // 4자리 이상으로 나올 수 있음(정상 동작).
    expect(data).toMatch(/^CSBC\d{4}\d{3,}$/);
  });

  it('RED: override 미지정 시 기존 B2B→CS+BB 하드코딩 형식 그대로 유지된다(회귀 방지)', async () => {
    const { data, error } = await callGenerateMemberCode('B2B', true, null);
    expect(error).toBeNull();
    expect(data).toMatch(/^CSBB\d{4}\d{3}$/);
  });

  it('RED: override 지정 시 그 접두어로 채번된다', async () => {
    const { data, error } = await callGenerateMemberCode('B2C', true, 'MB');
    expect(error).toBeNull();
    expect(data).toMatch(/^CSMB\d{4}\d{3}$/);
  });

  it('RED: override가 빈 문자열이면 안전하게 기존 폴백(BC/BB)으로 처리된다', async () => {
    const { data, error } = await callGenerateMemberCode('B2C', true, '');
    expect(error).toBeNull();
    expect(data).toMatch(/^CSBC\d{4}\d{3,}$/);
  });

  it('RED: 유효하지 않은 member_type은 에러를 반환한다(기존 동작 유지)', async () => {
    const { error } = await callGenerateMemberCode('INVALID', true, null);
    expect(error).not.toBeNull();
  });

  // 회귀 테스트 — GATE E 검수(@sp3-qa-agent, 2026-08-17) 중 Stage 실호출로 재현된 CRITICAL
  // 버그: member_code_sequences.member_type이 VARCHAR(2)로 정의돼 있어 2자를 넘는 override
  // (예: 코드조합이 여러 분류코드를 이어붙인 경우)를 채번하면 22001(value too long)로 실패,
  // 그 예외가 트리거를 통해 신규 회원가입 자체를 막을 수 있었다. migration 276에서
  // VARCHAR(30)으로 확장(product_code_sequences.category_code와 동일 폭)해 수정.
  it('REFACTOR: 2자를 초과하는 override(3자 이상)도 정상 채번된다(migration 276 회귀 방지)', async () => {
    const { data, error } = await callGenerateMemberCode('B2C', true, 'ABC');
    expect(error).toBeNull();
    expect(data).toMatch(/^CSABC\d{4}\d{3}$/);
  });

  // 회귀 테스트 — GATE E 통과 이후 Stephen이 실제 "일괄 재발급 실행" 버튼에서 재현·보고한
  // CRITICAL 버그: member_code_sequences의 순번이 1000 이상으로 누적된 상태에서
  // LPAD(v_seq::TEXT, 3, '0')이 "패딩"이 아니라 "오른쪽 절단"으로 동작해(Postgres LPAD 스펙)
  // 서로 다른 순번이 동일한 3자리 코드로 뭉개지며 기존 회원코드와 충돌했다(23505). migration
  // 277에서 LPAD 목표 길이를 GREATEST(3, 실제 자릿수)로 바꿔 절단을 원천 차단.
  // 실제 운영 카운터(next_seq)에 의존하지 않도록 격리된 테스트 전용 키로 직접 1005부터
  // 시작하는 상황을 재현한다.
  it('REFACTOR: 순번이 1000 이상으로 누적돼도 LPAD 절단 없이 전체 자릿수가 유지된다(migration 277 회귀 방지)', async () => {
    if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');
    const testKey = `ZZLPAD${Date.now()}`.slice(0, 30);
    const { error: seedError } = await adminClient
      .from('member_code_sequences')
      .insert({ member_type: testKey, year_month: 'all', next_seq: 1005 });
    if (seedError) throw new Error(`시퀀스 픽스처 시딩 실패: ${seedError.message}`);

    try {
      const { data, error } = await callGenerateMemberCode('B2C', false, testKey);
      expect(error).toBeNull();
      // 절단됐다면 'CS' + testKey + '100'(3자리로 잘림)이 되어 정규식에 실패한다.
      expect(data).toBe(`CS${testKey}1005`);
    } finally {
      await adminClient.from('member_code_sequences').delete().eq('member_type', testKey);
    }
  });
});

describe('bulk_reissue_member_codes — 기존 고객 일괄 재발급', () => {
  // ⚠️ user_profiles.id는 auth.users(id) FK라 테스트에서 신규 고객 행을 직접 만들 수 없다
  // (auth.users에 먼저 실사용자 인증 행이 있어야 함). bulk_reissue_member_codes는 설계상
  // WHERE deleted_at IS NULL 전체를 순회하는 시스템 전역 작업이므로, 격리된 픽스처 대신
  // 스테이지의 기존 고객 전원 상태를 스냅샷 → 재발급 검증 → 원상복구하는 방식으로 검증한다.
  let testUserIds: string[] = [];
  const originalCodes: Record<string, string | null> = {};
  const originalTypes: Record<string, string> = {};

  beforeAll(async () => {
    if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');

    const { data: rows, error } = await adminClient
      .from('user_profiles')
      .select('id, member_code, member_type')
      .is('deleted_at', null);
    if (error || !rows || rows.length === 0) {
      throw new Error(`재발급 대상 스냅샷 조회 실패: ${error?.message}`);
    }
    const typedRows = rows as { id: string; member_code: string | null; member_type: string }[];
    testUserIds = typedRows.map((r) => r.id);
    typedRows.forEach((r) => {
      originalCodes[r.id] = r.member_code;
      originalTypes[r.id] = r.member_type;
    });
  });

  afterAll(async () => {
    if (!adminClient || testUserIds.length === 0) return;
    // 재발급으로 생성된 로그부터 정리(원상복구 후 UNIQUE(member_code) 재사용 시 로그가
    // 남아있으면 old_code 이력이 왜곡되므로 먼저 삭제).
    await adminClient.from('member_code_reissue_log').delete().in('user_id', testUserIds);
    for (const uid of testUserIds) {
      await adminClient.from('user_profiles').update({ member_code: originalCodes[uid] }).eq('id', uid);
    }
  });

  it('RED: 빈/NULL 접두어는 안전하게 거부되고 아무것도 변경하지 않는다', async () => {
    const { data: emptyResult, error: emptyError } = await callBulkReissue('');
    expect(emptyError).toBeNull();
    expect(emptyResult?.success).toBe(false);

    const { data: nullResult, error: nullError } = await callBulkReissue(null);
    expect(nullError).toBeNull();
    expect(nullResult?.success).toBe(false);
  });

  it('GREEN: 유효한 접두어로 실행하면 대상 고객 전원의 member_code가 새 형식으로 갱신된다', async () => {
    const { data, error } = await callBulkReissue('RS');
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.reissued_count).toBeGreaterThanOrEqual(3);

    const { data: rows } = await adminClient!
      .from('user_profiles')
      .select('id, member_code')
      .in('id', testUserIds);
    for (const row of rows as { id: string; member_code: string | null }[]) {
      expect(row.member_code).toMatch(/^CSRS\d{4}\d{3}$/);
      expect(row.member_code).not.toBe(originalCodes[row.id]);
    }
  });

  it('REFACTOR: member_code_reissue_log에 각 고객의 old/new 코드 쌍이 정확히 기록된다', async () => {
    const { data: logRows } = await adminClient!
      .from('member_code_reissue_log')
      .select('user_id, old_code, new_code, reissued_by')
      .in('user_id', testUserIds)
      .order('reissued_at', { ascending: false });

    expect(logRows).not.toBeNull();
    for (const uid of testUserIds) {
      const entry = (logRows as { user_id: string; old_code: string | null; new_code: string; reissued_by: string }[]).find(
        (r) => r.user_id === uid
      );
      expect(entry).toBeTruthy();
      expect(entry?.old_code).toBe(originalCodes[uid]);
      expect(entry?.new_code).toMatch(/^CSRS\d{4}\d{3}$/);
      expect(entry?.reissued_by).toBe('vitest');
    }
  });
});
