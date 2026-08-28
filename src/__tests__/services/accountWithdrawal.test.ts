import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * T2: request_account_withdrawal RPC TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-①
 * 의존: T1(Migration #365 — user_profiles withdrawal 컬럼) Stage DB 적용 완료
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다 (deliveryCutoffHolidays.test.ts의 createEphemeralSession 패턴 동일 적용).
 * Migration #366(request_account_withdrawal RPC)이 Stage DB에 적용되기 전까지는
 * "Could not find the function" 등 RPC not found로 실패하는 것이 정상(RED 상태).
 *
 * B-START 3항목:
 *   정상동작 : 로그인한 회원이 유효한 사유를 선택해 탈퇴 신청하면 withdrawal_status='requested',
 *              withdrawal_purge_at=now()+30일이 세팅되고 {ok:true, purge_at} 반환.
 *   막아야할것: (A) 진행중 대여(hold/confirmed/shipped/in_use/return_requested)가 있는 경우
 *              → active_rental_exists 에러(DB 미변경). (B) 이미 requested 상태에서 재신청 →
 *              already_requested 에러. (C) anon(비로그인) 호출 → 로그인 필요 에러.
 *              (D) 유효하지 않은 사유 코드 / etc 포함+내용 없음 → 검증 에러.
 *   실패했을때: withdrawal_status가 'none'으로 유지되고 rental_reservations 변경 없음.
 *
 * 검증 항목:
 *   1. 정상 신청 — purge_at이 정확히 now()+30일 범위(±60초)인지 확인
 *   2. 진행중 대여 있는 계정 → active_rental_exists
 *   3. 이미 requested 상태 → already_requested
 *   4. anon 클라이언트(세션 없음) 호출 → 로그인 필요 에러
 *   5. p_reasons 빈 배열 → invalid_reasons 에러
 *   6. 'etc' 포함 but p_reason_etc 없음 → etc_required 에러
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
 * ephemeral 사용자를 생성하고 로그인 세션을 가진 클라이언트를 반환한다.
 * deliveryCutoffHolidays.test.ts의 createEphemeralSession 패턴과 동일.
 * auth.uid()를 사용하는 SECURITY DEFINER RPC 호출에 필수.
 */
async function createEphemeralSession(): Promise<{
  client: SupabaseClient;
  userId: string;
  cleanup: () => Promise<void>;
}> {
  const email = `tdd-withdrawal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
 * 테스트용 rental_reservation을 admin 권한으로 직접 생성한다.
 * 활성 대여 체크(active_rental_exists) 검증용.
 */
async function createTestReservation(userId: string, status: string): Promise<number> {
  // Stage DB에서 조회 가능한 임의 상품(부모 상품, is_active=true)을 선택
  const { data: product, error: prodErr } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (prodErr || !product) throw new Error(`테스트용 product 조회 실패: ${prodErr?.message}`);

  // 충돌 방지: 먼 미래의 랜덤 날짜 구간
  const dayOffset = Math.floor(Math.random() * 3650) + 365;
  const start = new Date(Date.UTC(2027, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: product.id,
      start_date: fmt(start),
      end_date: fmt(end),
      status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return data.id as number;
}

// ── RPC 타입 헬퍼 ───────────────────────────────────────────────────────────────

type WithdrawalResult = {
  ok: boolean;
  error?: string;
  error_code?: string;
  purge_at?: string;
};

type RpcResult<T = Record<string, unknown>> = {
  data: T | null;
  error: { code: string; message: string; details?: string } | null;
};

const rpcCall = <T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult<T>> =>
  (client.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<RpcResult<T>>)(fn, args);

// ── 테스트 스위트 ───────────────────────────────────────────────────────────────

describe('[TDD] request_account_withdrawal — 회원 자율 탈퇴 신청 RPC', () => {

  it('① 정상 신청: {ok:true, purge_at}을 반환하고 withdrawal_status=requested, purge_at=now()+30일이 세팅된다', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      {
        p_reasons: ['no_longer_use', 'lack_of_options'],
        p_reason_etc: null,
      }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.purge_at).toBeDefined();

    // purge_at이 now()+30일 ± 60초 범위인지 확인
    const purgeAt = new Date(data!.purge_at!).getTime();
    const expectedPurge = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const toleranceMs = 60 * 1000; // 60초 허용
    expect(purgeAt).toBeGreaterThan(expectedPurge - toleranceMs);
    expect(purgeAt).toBeLessThan(expectedPurge + toleranceMs);

    // DB 상태 확인 (admin으로 조회)
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status, withdrawal_reasons, withdrawal_reason_etc')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_status).toBe('requested');
    expect(profile?.withdrawal_reasons).toEqual(['no_longer_use', 'lack_of_options']);
    expect(profile?.withdrawal_reason_etc).toBeNull();
  });

  it('② 진행중 대여 있음(hold): {ok:false, error_code:"active_rental_exists"} — DB 미변경', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const reservationId = await createTestReservation(session.userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['no_longer_use'], p_reason_etc: null }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('active_rental_exists');

    // DB 상태 미변경 확인
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_status).toBe('none');
  });

  it('③ 진행중 대여 있음(in_use): active_rental_exists 차단', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const reservationId = await createTestReservation(session.userId, 'in_use');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['complex_process'], p_reason_etc: null }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('active_rental_exists');
  });

  it('④ 이미 requested 상태: {ok:false, error_code:"already_requested"}', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    // 1차 신청 (성공해야 함)
    const first = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['using_other_service'], p_reason_etc: null }
    );
    expect(first.data?.ok).toBe(true);

    // 2차 신청 (이미 requested → 차단)
    const second = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['no_longer_use'], p_reason_etc: null }
    );
    expect(second.error).toBeNull();
    expect(second.data?.ok).toBe(false);
    expect(second.data?.error_code).toBe('already_requested');
  });

  it('⑤ anon(비로그인) 호출: {ok:false, error:"로그인이 필요합니다."}', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

    const { data, error } = await rpcCall<WithdrawalResult>(
      anon,
      'request_account_withdrawal',
      { p_reasons: ['no_longer_use'], p_reason_etc: null }
    );

    // anon은 GRANT 미포함이므로 permission error 또는 ok:false 둘 다 허용
    // (REVOKE ALL FROM anon → PostgreSQL이 permission denied를 던질 수 있음)
    const isBlocked =
      error !== null ||
      (data?.ok === false && (data?.error?.includes('로그인') ?? false));
    expect(isBlocked).toBe(true);
  });

  it('⑥ p_reasons 빈 배열: {ok:false, error_code:"invalid_reasons"}', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: [], p_reason_etc: null }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('invalid_reasons');
  });

  it('⑦ 유효하지 않은 reason 코드 포함: {ok:false, error_code:"invalid_reasons"}', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['no_longer_use', 'INVALID_CODE'], p_reason_etc: null }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('invalid_reasons');
  });

  it('⑧ etc 포함 but p_reason_etc 없음(null): {ok:false, error_code:"etc_required"}', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      { p_reasons: ['etc'], p_reason_etc: null }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('etc_required');
  });

  it('⑨ etc 포함 + p_reason_etc 정상 입력: 신청 성공', async () => {
    const session = await createEphemeralSession();
    cleanups.push(session.cleanup);

    const { data, error } = await rpcCall<WithdrawalResult>(
      session.client,
      'request_account_withdrawal',
      {
        p_reasons: ['etc'],
        p_reason_etc: '서비스가 제 니즈에 맞지 않아요.',
      }
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);

    // withdrawal_reason_etc 저장 확인
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_reason_etc')
      .eq('id', session.userId)
      .single();
    expect(profile?.withdrawal_reason_etc).toBe('서비스가 제 니즈에 맞지 않아요.');
  });
});
