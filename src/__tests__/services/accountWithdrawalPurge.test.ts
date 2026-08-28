import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * T5: purge_withdrawn_accounts() RPC TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-③
 * 의존: T1(Migration #365 — withdrawal 컬럼) + Stage DB 적용 완료
 *       신규 Migration #368(purge_withdrawn_accounts RPC + pg_cron) — Stage DB 적용 전 RED 정상
 *
 * B-START 3항목:
 *   정상동작 : withdrawal_status='requested' + withdrawal_purge_at <= now() 인 행의
 *              PII 컬럼(full_name/phone/birth_date/address/avatar_url/identity_X/
 *              foreign_X) 전부 NULL + status='purged' + purged_at 세팅. email은 NOT NULL
 *              제약(TDD 라이브 테스트로 실제 발견, UNIQUE 없음)이라 NULL 대신 id 기반
 *              익명 placeholder(purged-{id}@purged.crazyshot.kr)로 대체.
 *   막아야할것: withdrawal_purge_at이 아직 미래인 requested 행은 건드리지 않음.
 *   실패했을때: 이용통계 컬럼(credit_score 등)은 purge 후에도 원래 값 그대로 유지.
 *
 * 검증 항목:
 *   ①+② 동일 purge 호출 1회 — past(①)는 purged / future(②)는 미변경 (경계값 분리)
 *   ③ purge 후 credit_score(이용통계) 원래 값 유지 — 개인식별정보 아닌 컬럼 무결성
 *
 * NOTE: purge_withdrawn_accounts()는 SECURITY DEFINER + service_role GRANT 전용.
 *       cron 함수라 파라미터 없음. 테스트는 admin 클라이언트로 직접 RPC 호출해 검증.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * ephemeral 사용자를 admin 권한으로만 생성한다.
 * purge_withdrawn_accounts는 cron 함수(service_role 전용)이므로
 * 사용자 세션(anon client)이 불필요 — admin 클라이언트로 직접 호출.
 */
async function createEphemeralUser(): Promise<{
  userId: string;
  originalEmail: string;
  cleanup: () => Promise<void>;
}> {
  const email = `tdd-purge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;

  return {
    userId,
    originalEmail: email,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    },
  };
}

/**
 * admin 권한으로 user_profiles에 withdrawal 상태를 직접 세팅하고 PII 필드도 채운다.
 * purgeAtOffsetSeconds: 양수=미래(초 단위), 음수=과거(초 단위)
 * (accountWithdrawalRestore.test.ts의 setWithdrawalStatus 동일 패턴)
 */
async function seedWithdrawal(
  userId: string,
  purgeAtOffsetSeconds: number,
): Promise<void> {
  const purgeAt = new Date(Date.now() + purgeAtOffsetSeconds * 1000).toISOString();

  const { error } = await admin
    .from('user_profiles')
    .update({
      full_name: 'TDD Purge Test User',
      withdrawal_status: 'requested',
      withdrawal_requested_at: new Date().toISOString(),
      withdrawal_purge_at: purgeAt,
      withdrawal_reasons: ['no_longer_use'],
      withdrawal_reason_etc: null,
    })
    .eq('id', userId);
  if (error) throw new Error(`withdrawal 상태 세팅 실패: ${error.message}`);
}

// ── 테스트 스위트 ───────────────────────────────────────────────────────────────

describe('[TDD] purge_withdrawn_accounts — 30일 경과 PII 자동삭제 RPC', () => {

  it(
    '①+② 단일 함수 호출: past purge_at(①)는 purged / future purge_at(②)는 미변경 — 경계값 분리 확인',
    async () => {
      // ── 픽스처: 두 유저를 먼저 만든 뒤 한 번의 purge 호출로 검증 ──────

      const pastUser = await createEphemeralUser();
      cleanups.push(pastUser.cleanup);

      const futureUser = await createEphemeralUser();
      cleanups.push(futureUser.cleanup);

      // ① past: purge_at = 어제 (24시간 전)
      await seedWithdrawal(pastUser.userId, -24 * 60 * 60);
      // ② future: purge_at = 10일 후
      await seedWithdrawal(futureUser.userId, 10 * 24 * 60 * 60);

      // ── purge 실행 (service_role 전용 — admin 클라이언트로 직접 호출) ──
      const { error: rpcErr } = await admin.rpc('purge_withdrawn_accounts');
      expect(rpcErr).toBeNull();

      // ── ① past 유저 검증: PII NULL + withdrawal_status='purged' ────────
      // Supabase 타입 추론은 database.ts 기준이므로, 신규 컬럼들은 unknown으로 캐스팅한다
      // (T1 migration #365 컬럼들이 database.ts에 아직 미반영 — 실제 DB 조회는 정상)
      const { data: pastRaw, error: pastErr } = await admin
        .from('user_profiles')
        .select('withdrawal_status, withdrawal_purged_at, withdrawal_purge_at, withdrawal_requested_at, withdrawal_reasons, withdrawal_reason_etc, full_name, email')
        .eq('id', pastUser.userId)
        .single();
      const past = pastRaw as Record<string, unknown> | null;

      expect(pastErr).toBeNull();
      expect(past?.['withdrawal_status']).toBe('purged');
      expect(past?.['withdrawal_purged_at']).not.toBeNull();     // purged_at 세팅됨
      expect(past?.['withdrawal_purge_at']).toBeNull();          // purge_at NULL
      expect(past?.['withdrawal_requested_at']).toBeNull();      // requested_at NULL
      expect(past?.['withdrawal_reasons']).toBeNull();           // reasons NULL
      expect(past?.['withdrawal_reason_etc']).toBeNull();        // etc NULL
      expect(past?.['full_name']).toBeNull();                    // PII NULL
      // email은 NOT NULL 제약(TDD 라이브 통합테스트로 실제 발견, UNIQUE는 없음) — NULL 대신
      // id 기반 익명 placeholder로 대체되므로, "원래 이메일과 다르다" + "익명화 패턴과 일치"로 검증
      expect(past?.['email']).not.toBe(pastUser.originalEmail);
      expect(past?.['email']).toMatch(/^purged-[0-9a-f-]+@purged\.crazyshot\.kr$/);

      // ── ② future 유저 검증: withdrawal_status='requested' 그대로 ───────
      const { data: futureRaw, error: futureErr } = await admin
        .from('user_profiles')
        .select('withdrawal_status, full_name, withdrawal_purge_at')
        .eq('id', futureUser.userId)
        .single();
      const future = futureRaw as Record<string, unknown> | null;

      expect(futureErr).toBeNull();
      expect(future?.['withdrawal_status']).toBe('requested');       // 변경 없음
      expect(future?.['full_name']).toBe('TDD Purge Test User');     // PII 그대로
      expect(future?.['withdrawal_purge_at']).not.toBeNull();        // purge_at 보존
    },
    30_000,
  );

  it(
    '③ purge 후 credit_score(이용통계) 원래 값 유지 — member_code·credit_score 등 비PII 컬럼 무결성',
    async () => {
      const user = await createEphemeralUser();
      cleanups.push(user.cleanup);

      // purge 전 credit_score 기본값 확인
      const { data: before, error: beforeErr } = await admin
        .from('user_profiles')
        .select('credit_score')
        .eq('id', user.userId)
        .single();
      const beforeProfile = before as Record<string, unknown> | null;

      expect(beforeErr).toBeNull();
      const originalScore = beforeProfile?.['credit_score'];
      expect(originalScore).not.toBeUndefined();

      // past purge_at으로 세팅 (1초 전)
      await seedWithdrawal(user.userId, -1);

      // purge 실행
      const { error: rpcErr } = await admin.rpc('purge_withdrawn_accounts');
      expect(rpcErr).toBeNull();

      // purge 후 검증 — withdrawal_status='purged' + credit_score 원래 값 유지
      const { data: after, error: afterErr } = await admin
        .from('user_profiles')
        .select('withdrawal_status, credit_score')
        .eq('id', user.userId)
        .single();
      const afterProfile = after as Record<string, unknown> | null;

      expect(afterErr).toBeNull();
      expect(afterProfile?.['withdrawal_status']).toBe('purged');
      expect(afterProfile?.['credit_score']).toBe(originalScore); // 이용통계 무변경
    },
    15_000,
  );
});
