import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * T6: verify_and_update_phone — 탈퇴유예중 계정 휴대폰 충돌 차단 TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-④
 * 의존:
 *   - T1 (Migration #365 — user_profiles withdrawal 컬럼) Stage DB 적용 완료
 *   - 신규 Migration #370 (verify_and_update_phone CREATE OR REPLACE 로직 확장) —
 *     Stage DB 적용 전까지는 withdrawal_conflict 케이스가 {ok:true}로 통과되거나
 *     내부 에러로 실패 — 케이스①이 RED인 것이 정상.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다. accountWithdrawal.test.ts / accountWithdrawalRestore.test.ts 와 동일 패턴.
 *
 * Q8 확정 정책:
 *   탈퇴 유예기간 중인 계정(withdrawal_status='requested')과 동일 휴대폰번호로
 *   다른 계정이 인증을 시도하면, 계정을 병합하지 않고 안내만 하고 막는다.
 *
 * B-START 3항목:
 *   정상동작 : 탈퇴유예중 다른 계정의 휴대폰번호로 verify_and_update_phone을 호출하면
 *              {ok:false, error_code:'withdrawal_conflict'} 반환 + 호출자 phone 미변경.
 *   막아야할것: OTP가 유효해도 상대가 탈퇴유예중이면 phone 업데이트가 일어나지 않아야 함.
 *   실패했을때: 케이스②③(회귀) — 상대가 정상 회원이거나 겹침 없으면 기존대로 ok:true 반환.
 *
 * 검증 항목:
 *   ① 탈퇴유예중 다른 계정의 휴대폰으로 시도 → withdrawal_conflict + 호출자 phone 미변경
 *   ② 동일 휴대폰이지만 상대가 정상 회원(none) → 기존 동작 그대로 ok:true (회귀 없음)
 *   ③ 휴대폰 중복 없음 → 정상 저장 ok:true (회귀 없음)
 *
 * 알려진 스키마 메모:
 *   - user_profiles.phone: VARCHAR(20), UNIQUE 제약 없음 (GIN trigram 인덱스만 존재)
 *   - user_profiles.id = auth.users.id (Stage DB의 handle_new_user 트리거가 id=NEW.id로 삽입)
 *   - phone_otps RLS: FOR ALL USING (false) — admin(service_role) 직접 INSERT 필요
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
 * accountWithdrawal.test.ts의 createEphemeralSession 패턴과 동일.
 */
async function createEphemeralSession(): Promise<{
  client: SupabaseClient;
  userId: string;
  cleanup: () => Promise<void>;
}> {
  const email = `tdd-phone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
 * admin 권한으로 user_profiles.phone을 직접 세팅한다.
 * phone_otps OTP 흐름 없이 특정 계정의 phone 컬럼을 픽스처로 설정하는 용도.
 * user_profiles.id = auth.users.id (Stage DB 트리거 방식)
 */
async function setUserPhone(userId: string, phone: string): Promise<void> {
  const { error } = await admin
    .from('user_profiles')
    .update({ phone })
    .eq('id', userId);
  if (error) throw new Error(`phone 세팅 실패: ${error.message}`);
}

/**
 * admin 권한으로 user_profiles.withdrawal_status를 직접 세팅한다.
 * accountWithdrawalRestore.test.ts의 setWithdrawalStatus 패턴과 동일.
 */
async function setWithdrawalStatus(
  userId: string,
  status: 'requested' | 'none',
): Promise<void> {
  const { error } = await admin
    .from('user_profiles')
    .update({
      withdrawal_status: status,
      withdrawal_requested_at: status === 'requested' ? new Date().toISOString() : null,
      withdrawal_purge_at:
        status === 'requested'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      withdrawal_reasons: status === 'requested' ? ['no_longer_use'] : null,
      withdrawal_reason_etc: null,
    })
    .eq('id', userId);
  if (error) throw new Error(`withdrawal_status 세팅 실패: ${error.message}`);
}

/**
 * admin 권한으로 phone_otps에 유효한 OTP를 직접 삽입한다.
 * phone_otps RLS가 FOR ALL USING(false)이라 service_role만 가능.
 * verify_and_update_phone 호출 직전 픽스처로 사용.
 */
async function createValidOtp(userId: string, phone: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5분 후
  const { error } = await admin.from('phone_otps').insert({
    user_id: userId,
    phone,
    code,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`OTP 생성 실패: ${error.message}`);
}

// ── RPC 호출 헬퍼 ───────────────────────────────────────────────────────────────

type PhoneUpdateResult = {
  ok: boolean;
  error?: string;
  error_code?: string;
};

async function callVerifyAndUpdatePhone(
  client: SupabaseClient,
  phone: string,
  code: string,
): Promise<{ data: PhoneUpdateResult | null; error: unknown }> {
  const { data, error } = await client.rpc('verify_and_update_phone', {
    p_phone: phone,
    p_code: code,
  });
  return { data: data as PhoneUpdateResult | null, error };
}

// ── 테스트 ──────────────────────────────────────────────────────────────────────

describe('verify_and_update_phone — 탈퇴유예중 계정 휴대폰 충돌 차단 (T6)', () => {
  it('① 탈퇴유예중 다른 계정의 휴대폰으로 시도 → withdrawal_conflict + 호출자 phone 미변경', async () => {
    // 계정 A: 탈퇴 유예기간 중, phone = '01011110001'
    const sessionA = await createEphemeralSession();
    cleanups.push(sessionA.cleanup);
    await setUserPhone(sessionA.userId, '01011110001');
    await setWithdrawalStatus(sessionA.userId, 'requested');

    // 계정 B: 신규 인증 시도, OTP를 '01011110001'로 생성
    const sessionB = await createEphemeralSession();
    cleanups.push(sessionB.cleanup);
    await createValidOtp(sessionB.userId, '01011110001', 'T6CODE1');

    // B가 A의 휴대폰번호로 verify_and_update_phone 호출
    const { data, error } = await callVerifyAndUpdatePhone(
      sessionB.client,
      '01011110001',
      'T6CODE1',
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error_code).toBe('withdrawal_conflict');

    // B의 phone이 변경되지 않았는지 확인
    const { data: profileB } = await admin
      .from('user_profiles')
      .select('phone')
      .eq('id', sessionB.userId)
      .single();
    // B의 phone은 여전히 null (또는 초기값) — '01011110001'로 바뀌면 안 됨
    expect(profileB?.phone).not.toBe('01011110001');
  });

  it('② 동일 휴대폰이지만 상대(A)가 정상 회원(none) → ok:true (회귀 없음)', async () => {
    // 계정 A: 정상 회원, phone = '01022220002'
    const sessionA = await createEphemeralSession();
    cleanups.push(sessionA.cleanup);
    await setUserPhone(sessionA.userId, '01022220002');
    await setWithdrawalStatus(sessionA.userId, 'none'); // 명시적으로 none

    // 계정 B: 동일 번호로 인증 시도
    const sessionB = await createEphemeralSession();
    cleanups.push(sessionB.cleanup);
    await createValidOtp(sessionB.userId, '01022220002', 'T6CODE2');

    const { data, error } = await callVerifyAndUpdatePhone(
      sessionB.client,
      '01022220002',
      'T6CODE2',
    );

    // withdrawal_conflict 차단 없이 기존 동작 그대로 통과해야 함
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.error_code).toBeUndefined();

    // B의 phone이 정상 업데이트됐는지 확인
    const { data: profileB } = await admin
      .from('user_profiles')
      .select('phone')
      .eq('id', sessionB.userId)
      .single();
    expect(profileB?.phone).toBe('01022220002');
  });

  it('③ 휴대폰 중복 없는 정상 케이스 → ok:true (회귀 없음)', async () => {
    // 계정 B만: 고유한 번호로 인증 시도
    const sessionB = await createEphemeralSession();
    cleanups.push(sessionB.cleanup);
    await createValidOtp(sessionB.userId, '01099990003', 'T6CODE3');

    const { data, error } = await callVerifyAndUpdatePhone(
      sessionB.client,
      '01099990003',
      'T6CODE3',
    );

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.error_code).toBeUndefined();

    // B의 phone이 정상 업데이트됐는지 확인
    const { data: profileB } = await admin
      .from('user_profiles')
      .select('phone')
      .eq('id', sessionB.userId)
      .single();
    expect(profileB?.phone).toBe('01099990003');
  });
});
