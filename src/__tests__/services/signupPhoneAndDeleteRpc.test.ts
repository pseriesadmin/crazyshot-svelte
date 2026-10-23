import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * Migration #748·#749·#750 라이브 통합테스트 (Stage DB — ezyvffjvuwmtuhpxdjrw)
 *   #748 check_phone_registered  — 하이픈 무시 비교·삭제 계정 제외·빈 입력·anon/authenticated 호출
 *   #749 soft_delete_customer    — name→full_name 수정(항상 실패하던 삭제가 성공)·재호출 안내·권한(service_role 전용)
 *   #750 verify_and_update_phone — 하이픈 형식으로 저장된 번호의 중복·탈퇴 유예 비교
 * accountWithdrawalPhone.test.ts 와 같은 방식: 시험마다 ephemeral 사용자를 만들고 afterEach에서 삭제한다.
 * 번호는 이 파일 전용 대역(0105555xxxx)만 쓴다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-signupphone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  });
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`);
  return { client, userId };
}

async function patchProfile(userId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('user_profiles').update(patch).eq('id', userId);
  if (error) throw new Error(`프로필 갱신 실패: ${error.message}`);
}

async function getProfile(userId: string): Promise<{ full_name: string | null; phone: string | null; deleted_at: string | null; blacklisted: boolean | null }> {
  const { data, error } = await admin.from('user_profiles').select('full_name, phone, deleted_at, blacklisted').eq('id', userId).single();
  if (error || !data) throw new Error(`프로필 조회 실패: ${error?.message}`);
  return data as { full_name: string | null; phone: string | null; deleted_at: string | null; blacklisted: boolean | null };
}

async function createOtp(userId: string, phone: string, code: string): Promise<void> {
  const { error } = await admin.from('phone_otps').insert({
    user_id: userId,
    phone,
    code,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`OTP 생성 실패: ${error.message}`);
}

type VerifyResult = { ok: boolean; error?: string; error_code?: string };
async function verifyPhone(client: SupabaseClient, phone: string, code: string): Promise<VerifyResult | null> {
  const { data, error } = await client.rpc('verify_and_update_phone', { p_phone: phone, p_code: code });
  expect(error).toBeNull();
  return data as VerifyResult | null;
}

describe('#748 check_phone_registered', () => {
  it('하이픈 유무와 상관없이 같은 번호를 가입된 번호로 판정한다', async () => {
    const a = await createSession();
    await patchProfile(a.userId, { phone: '010-5555-0001' }); // 하이픈 형식으로 저장된 번호

    for (const input of ['01055550001', '010-5555-0001', '010 5555 0001']) {
      const { data, error } = await anon.rpc('check_phone_registered', { p_phone: input });
      expect(error).toBeNull();
      expect(data, `입력 ${input}`).toBe(true);
    }
    const { data: other } = await anon.rpc('check_phone_registered', { p_phone: '01055559999' });
    expect(other).toBe(false);
  });

  it('빈 입력·숫자 없는 입력은 false, 삭제된 계정의 번호는 제외한다', async () => {
    for (const input of ['', '---', 'abc']) {
      const { data, error } = await anon.rpc('check_phone_registered', { p_phone: input });
      expect(error).toBeNull();
      expect(data, `입력 "${input}"`).toBe(false);
    }
    const a = await createSession();
    await patchProfile(a.userId, { phone: '01055550002' });
    expect((await anon.rpc('check_phone_registered', { p_phone: '01055550002' })).data).toBe(true);
    await patchProfile(a.userId, { deleted_at: new Date().toISOString() }); // 번호는 남기고 삭제 표시만
    expect((await anon.rpc('check_phone_registered', { p_phone: '01055550002' })).data).toBe(false);
  });

  it('로그인한 일반 사용자(authenticated)도 호출할 수 있고 boolean만 돌려준다', async () => {
    const a = await createSession();
    const { data, error } = await a.client.rpc('check_phone_registered', { p_phone: '01055550003' });
    expect(error).toBeNull();
    expect(typeof data).toBe('boolean');
  });
});

describe('#749 soft_delete_customer', () => {
  it('삭제가 성공하고(이름 [삭제된 계정]·번호 비움·블랙리스트 해제), 다시 호출하면 이미 삭제 안내', async () => {
    const a = await createSession();
    await patchProfile(a.userId, { full_name: '삭제시험', phone: '01055550004', blacklisted: true });

    const { data: first, error } = await admin.rpc('soft_delete_customer', { p_user_id: a.userId, p_deleted_by: 'tdd' });
    expect(error).toBeNull();
    expect(first).toEqual({ ok: true });

    const profile = await getProfile(a.userId);
    expect(profile.full_name).toBe('[삭제된 계정]');
    expect(profile.phone).toBeNull();
    expect(profile.blacklisted).toBe(false);
    expect(profile.deleted_at).not.toBeNull();

    const { data: second } = await admin.rpc('soft_delete_customer', { p_user_id: a.userId, p_deleted_by: 'tdd' });
    expect(second).toEqual({ ok: false, error: '이미 삭제된 계정입니다.' });
  });

  it('없는 계정은 찾을 수 없음 안내(칼럼 오류 없이 실행됨)', async () => {
    const { data, error } = await admin.rpc('soft_delete_customer', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_deleted_by: 'tdd',
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, error: '계정을 찾을 수 없습니다.' });
  });

  it('서버 전용 — anon·로그인 사용자는 실행할 수 없다', async () => {
    const a = await createSession();
    const asAnon = await anon.rpc('soft_delete_customer', { p_user_id: a.userId, p_deleted_by: 'tdd' });
    expect(asAnon.error).not.toBeNull();
    const asUser = await a.client.rpc('soft_delete_customer', { p_user_id: a.userId, p_deleted_by: 'tdd' });
    expect(asUser.error).not.toBeNull();
    expect((await getProfile(a.userId)).deleted_at).toBeNull(); // 실제로 삭제되지 않았다
  });
});

describe('#750 verify_and_update_phone — 하이픈 무시 비교', () => {
  it('다른 계정에 하이픈 형식으로 저장된 번호도 중복으로 거절하고 호출자 번호는 바뀌지 않는다', async () => {
    const a = await createSession();
    await patchProfile(a.userId, { phone: '010-5555-0005' });
    const b = await createSession();
    await createOtp(b.userId, '01055550005', 'T750C1');

    const result = await verifyPhone(b.client, '01055550005', 'T750C1');
    expect(result?.ok).toBe(false);
    expect(result?.error_code).toBe('phone_duplicate');
    expect((await getProfile(b.userId)).phone).not.toBe('01055550005');
  });

  it('탈퇴 유예 계정의 하이픈 형식 번호도 withdrawal_conflict로 거절한다', async () => {
    const a = await createSession();
    await patchProfile(a.userId, {
      phone: '010-5555-0006',
      withdrawal_status: 'requested',
      withdrawal_requested_at: new Date().toISOString(),
      withdrawal_purge_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      withdrawal_reasons: ['no_longer_use'],
    });
    const b = await createSession();
    await createOtp(b.userId, '01055550006', 'T750C2');

    const result = await verifyPhone(b.client, '01055550006', 'T750C2');
    expect(result?.ok).toBe(false);
    expect(result?.error_code).toBe('withdrawal_conflict');
  });

  it('겹치지 않는 번호는 정상 저장(회귀 없음)', async () => {
    const b = await createSession();
    await createOtp(b.userId, '01055550007', 'T750C3');

    const result = await verifyPhone(b.client, '01055550007', 'T750C3');
    expect(result).toEqual({ ok: true });
    expect((await getProfile(b.userId)).phone).toBe('01055550007');
  });
});
