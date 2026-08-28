import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * T4: restore_withdrawn_account RPC TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-②
 * 의존: T1(Migration #365 — user_profiles withdrawal 컬럼) Stage DB 적용 완료
 *       T2(Migration #366 — request_account_withdrawal) Stage DB 적용 완료
 *       신규 Migration #367(restore_withdrawn_account RPC) — Stage DB 적용 전 RED 정상
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다. accountWithdrawal.test.ts의 createEphemeralSession 패턴 동일 적용.
 * Migration #367이 Stage DB에 적용되기 전까지는 "Could not find the function" 등으로
 * 실패하는 것이 정상(RED 상태).
 *
 * B-START 3항목:
 *   정상동작 : requested 상태의 계정이 유예기간 내에 로그인하면 withdrawal_status='none'으로
 *              초기화되어 자동복구되고 {ok:true, restored:true}를 반환한다.
 *   막아야할것: (A) purge_at이 이미 경과된 경우 → 복구하지 않고 {ok:true, restored:false, expired:true}
 *              (B) withdrawal_status='none'인 정상계정 호출 → idempotent no-op {ok:true, restored:false}
 *              (C) anon(비로그인) 호출 → permission denied 또는 로그인 필요 에러
 *   실패했을때: DB 상태가 변경되지 않아야 하며(recovered:false), 서비스 접근에 영향 없음.
 *
 * 검증 항목:
 *   ① withdrawal_status='none' 정상계정 호출 → {ok:true, restored:false} (idempotent no-op)
 *   ② requested + purge_at=미래(now()+10일) → {ok:true, restored:true}, DB withdrawal_status='none' 초기화
 *   ③ requested + purge_at=과거(now()-1일, cron 미실행 경계) → {ok:true, restored:false, expired:true}, DB 미변경
 *   ④ anon(비로그인) 호출 → 로그인 필요 에러 또는 permission denied
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

async function createEphemeralSession(): Promise<{
  client: SupabaseClient;
  userId: string;
  cleanup: () => Promise<void>;
}> {
  const email = `tdd-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`);

  return {
    client: asUser,
    userId,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    },
  };
}

/**
 * admin 권한으로 user_profiles의 withdrawal 상태를 직접 세팅한다.
 * - purge_at을 과거로 세팅하는 케이스③처럼 RPC①으로는 만들 수 없는 시나리오에 필수.
 */
async function setWithdrawalStatus(
  userId: string,
  status: 'requested' | 'none',
  purgeAtOffset?: number, // 양수: 미래(초 단위), 음수: 과거(초 단위)
): Promise<void> {
  const purgeAt =
    purgeAtOffset !== undefined
      ? new Date(Date.now() + purgeAtOffset * 1000).toISOString()
      : null;

  const { error } = await admin
    .from('user_profiles')
    .update({
      withdrawal_status: status,
      withdrawal_requested_at: status === 'requested' ? new Date().toISOString() : null,
      withdrawal_purge_at: purgeAt,
      withdrawal_reasons: status === 'requested' ? ['no_longer_use'] : null,
      withdrawal_reason_etc: null,
    })
    .eq('id', userId);
  if (error) throw new Error(`withdrawal_status 세팅 실패: ${error.message}`);
}

// ── RPC 타입 헬퍼 ───────────────────────────────────────────────────────────────

type RestoreResult = {
  ok: boolean;
  restored?: boolean;
  expired?: boolean;
  error?: string;
};

type RpcResult<T = Record<string, unknown>> = {
  data: T | null;
  error: { code: string; message: string; details?: string } | null;
};

const rpcCall = <T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {}
): Promise<RpcResult<T>> =>
  (client.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<RpcResult<T>>)(fn, args);

// ── 테스트 스위트 ───────────────────────────────────────────────────────────────

describe('[TDD] restore_withdrawn_account — 탈퇴 자동복구 RPC', () => {

  it('① withdrawal_status=none 정상계정 호출: {ok:true, restored:false} — idempotent no-op', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);
    // withdrawal_status는 기본값 'none' — 별도 세팅 불필요

    const { data, error } = await rpcCall<RestoreResult>(
      session.client,
      'restore_withdrawn_account',
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.restored).toBe(false);

    // DB 상태 미변경 확인
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_status).toBe('none');
  });

  it('② requested + purge_at=미래(+10일): {ok:true, restored:true} + DB withdrawal_status=none 초기화', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    // purge_at = 지금부터 10일 후 (유예기간 내)
    await setWithdrawalStatus(session.userId, 'requested', 10 * 24 * 60 * 60);

    const { data, error } = await rpcCall<RestoreResult>(
      session.client,
      'restore_withdrawn_account',
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.restored).toBe(true);

    // DB 초기화 확인 — 전체 4 컬럼이 NULL로 돌아왔는지 확인
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status, withdrawal_requested_at, withdrawal_purge_at, withdrawal_reasons, withdrawal_reason_etc')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_status).toBe('none');
    expect(profile?.withdrawal_requested_at).toBeNull();
    expect(profile?.withdrawal_purge_at).toBeNull();
    expect(profile?.withdrawal_reasons).toBeNull();
    expect(profile?.withdrawal_reason_etc).toBeNull();
  });

  it('③ requested + purge_at=과거(-1일, cron 실행 전 경계): {ok:true, restored:false, expired:true} + DB 미변경', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    // purge_at = 어제 (경계 케이스 — cron이 아직 안 돌아서 'requested' 상태로 남아있음)
    await setWithdrawalStatus(session.userId, 'requested', -24 * 60 * 60);

    const { data, error } = await rpcCall<RestoreResult>(
      session.client,
      'restore_withdrawn_account',
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.restored).toBe(false);
    expect(data?.expired).toBe(true);

    // DB 상태 미변경 확인 — 'requested'로 그대로 남아야 함
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_status).toBe('requested');
  });

  it('④ anon(비로그인) 호출: permission denied 또는 로그인 필요 에러', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

    const { data, error } = await rpcCall<RestoreResult>(
      anon,
      'restore_withdrawn_account',
    );

    // anon은 GRANT 미포함 → PostgreSQL permission denied 또는 RPC 자체 로그인 에러 반환
    const isBlocked =
      error !== null ||
      (data?.ok === false && (data?.error?.includes('로그인') ?? false));
    expect(isBlocked).toBe(true);
  });
});
