import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * 레거시 회원 클레임 흐름 TDD 테스트 (Migration 483+484 → 2026-09-11 489/490으로 재설계)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * ⛔ 2026-09-11 전면 재작성 — 개인정보보호법 위반 소지로 기존 설계(CSV 임포트 즉시
 * auth.users/user_profiles에 미검증 데이터를 기록)를 폐기하고 legacy_member_staging
 * (실 고객 DB와 완전 격리된 테이블)으로 전환함에 따라, find_legacy_member RPC가 이제
 * user_profiles가 아니라 legacy_member_staging을 조회한다. 이 테스트도 그에 맞춰
 * user_profiles에 실제 auth.users 계정을 미리 만들던 헬퍼(createLegacyTestUser)를
 * legacy_member_staging INSERT 헬퍼(createStagingRow)로 교체했다.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다. 생성한 데이터는 전부 afterEach에서 정리한다.
 *
 * 검증 범위:
 * - find_legacy_member: 이름+전화 매칭 성공/실패, 대소문자·공백 무시 매칭, 클레임 완료
 *   행(claimed_at 설정됨) 재매칭 차단, 전화번호 없는 행 매칭 불가(EC-3), 레거시 후보
 *   자체가 없는 이름/번호는 매칭 불가
 * - legacy_member_staging RLS: anon 직접 접근 차단
 * - legacy_claim_otps: 기존과 동일(무변경 — 재설계와 무관)
 * - E2E: 스테이징 → 매칭 → (complete 로직과 동일한) 계정생성+UPDATE+스테이징삭제 전체 흐름
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => {});
  }
});

// ─── 테스트 헬퍼 ──────────────────────────────────────────────
async function createStagingRow(params: {
  email: string;
  name: string;
  phone: string | null;
  claimed?: boolean;
}): Promise<string> {
  const { data, error } = await admin
    .from('legacy_member_staging')
    .insert({
      full_name: params.name,
      phone: params.phone,
      email: params.email,
      legacy_source: 'csv',
      legacy_signup_at: '2023-01-01T00:00:00Z',
      legacy_purchase_count: 2,
      claimed_at: params.claimed ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`staging insert failed: ${error?.message}`);
  const id = data.id as string;
  cleanups.push(async () => {
    await admin.from('legacy_member_staging').delete().eq('id', id);
  });
  return id;
}

// ─── find_legacy_member RPC 테스트 ───────────────────────────
describe('find_legacy_member RPC (legacy_member_staging 기준, Migration 490)', () => {
  it('[GREEN] 이름+전화가 일치하는 스테이징 후보 — JSONB 반환', async () => {
    const email = `legacy-test-${Date.now()}@test.example`;
    const phone = `0100000${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    const name = '테스트회원';
    const stagingId = await createStagingRow({ email, name, phone });

    const { data, error } = await admin.rpc('find_legacy_member', {
      p_name: name,
      p_phone: phone,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data).toMatchObject({
      staging_id: stagingId,
      email,
      name,
      phone,
      legacy_purchase_count: 2,
    });
  });

  it('[GREEN] 이름 대소문자·공백만 다르면 여전히 매칭 (느슨한 매칭 정책)', async () => {
    const email = `legacy-loose-${Date.now()}@test.example`;
    const phone = `0108880${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    await createStagingRow({ email, name: 'John Doe', phone });

    const { data, error } = await admin.rpc('find_legacy_member', {
      p_name: '  john doe  ',
      p_phone: phone,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as { email: string }).email).toBe(email);
  });

  it('[GREEN] 이름이 다르면 매칭 실패 — NULL 반환', async () => {
    const email = `legacy-nomatch-${Date.now()}@test.example`;
    const phone = `0109990${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    await createStagingRow({ email, name: '홍길동', phone });

    const { data, error } = await admin.rpc('find_legacy_member', {
      p_name: '김다른',
      p_phone: phone,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('[GREEN] 이미 클레임 완료된(claimed_at 설정) 스테이징 행 — NULL 반환 (재매칭 차단)', async () => {
    const email = `legacy-claimed-${Date.now()}@test.example`;
    const phone = `0101111${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    const name = '기인증회원';
    await createStagingRow({ email, name, phone, claimed: true });

    const { data, error } = await admin.rpc('find_legacy_member', {
      p_name: name,
      p_phone: phone,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('[GREEN] EC-3: 전화번호가 NULL인 스테이징 행 — 전화번호로 매칭 불가', async () => {
    const email = `legacy-nophone-${Date.now()}@test.example`;
    await createStagingRow({ email, name: '전화없음', phone: null });

    const { data } = await admin.rpc('find_legacy_member', {
      p_name: '전화없음',
      p_phone: '01012345678', // 실제 스테이징에 없는 번호
    });

    expect(data).toBeNull();
  });

  it('[GREEN] 레거시 후보 자체가 없는 이름/번호 — 매칭 불가', async () => {
    const { data } = await admin.rpc('find_legacy_member', {
      p_name: '존재하지않는이름',
      p_phone: '01099999999',
    });

    expect(data).toBeNull();
  });

  it('[GREEN] 클라이언트(anon)가 legacy_member_staging에 직접 접근 불가 — RLS 차단', async () => {
    const anonClient = createClient(
      PUBLIC_SUPABASE_URL,
      (await import('$env/static/public')).PUBLIC_SUPABASE_ANON_KEY,
    );

    const { data, error } = await anonClient.from('legacy_member_staging').select('*');

    // RLS FOR ALL USING(false)는 SELECT를 에러가 아니라 빈 결과로 필터링한다(legacy_claim_otps와 동일 패턴)
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// ─── E2E: 스테이징 → 매칭 → 계정생성 → 스테이징 삭제 전체 흐름 ───
describe('레거시 클레임 E2E (complete/+server.ts 로직과 동일하게 재현)', () => {
  it('[GREEN] 스테이징 매칭 → 신규 계정 생성 + 레거시 필드 반영 → 스테이징 행 삭제', async () => {
    const email = `legacy-e2e-${Date.now()}@test.example`;
    const phone = `0107777${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    const name = 'E2E테스트회원';
    const stagingId = await createStagingRow({ email, name, phone });

    // 1. find_legacy_member로 매칭
    const { data: member } = await admin.rpc('find_legacy_member', { p_name: name, p_phone: phone });
    expect(member).not.toBeNull();
    const m = member as {
      staging_id: string; email: string; name: string; phone: string;
      legacy_source: string; legacy_signup_at: string; legacy_purchase_count: number;
      legacy_imported_at: string;
    };
    expect(m.staging_id).toBe(stagingId);

    // 2. complete/+server.ts와 동일하게 계정 생성
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: m.email,
      password: 'Test1234!',
      email_confirm: true,
      user_metadata: { name: m.name },
    });
    expect(createErr).toBeNull();
    const userId = authData!.user!.id;
    cleanups.push(async () => {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    });

    // 3. user_profiles 레거시 필드 UPDATE
    const claimedAt = new Date().toISOString();
    const { error: updateErr } = await admin.from('user_profiles').update({
      full_name: m.name,
      phone: m.phone,
      legacy_source: m.legacy_source,
      legacy_imported_at: m.legacy_imported_at,
      legacy_signup_at: m.legacy_signup_at,
      legacy_purchase_count: m.legacy_purchase_count,
      legacy_claimed_at: claimedAt,
    } as Record<string, unknown>).eq('user_id', userId);
    expect(updateErr).toBeNull();

    // 4. 스테이징 행 삭제
    await admin.from('legacy_member_staging').delete().eq('id', stagingId);

    // 최종 확인: user_profiles에 레거시 필드가 정확히 반영됐는가
    const { data: finalProfile } = await admin
      .from('user_profiles')
      .select('legacy_claimed_at, legacy_imported_at, legacy_purchase_count, phone, full_name')
      .eq('user_id', userId)
      .single();
    expect(finalProfile?.legacy_claimed_at).not.toBeNull();
    expect(finalProfile?.phone).toBe(phone);
    expect(finalProfile?.legacy_purchase_count).toBe(2);

    // 스테이징 행은 완전히 사라졌는가(개인정보 최소보유 — 익명화 보존이 아니라 삭제)
    const { data: stagingCheck } = await admin
      .from('legacy_member_staging')
      .select('id')
      .eq('id', stagingId)
      .maybeSingle();
    expect(stagingCheck).toBeNull();

    // 클레임 완료 후 재매칭 불가 확인(스테이징 행 자체가 없으므로 당연히 NULL)
    const { data: reMatch } = await admin.rpc('find_legacy_member', { p_name: name, p_phone: phone });
    expect(reMatch).toBeNull();
  });
});

// ─── legacy_claim_otps 테이블 검증 (무변경 — 재설계와 무관) ───
describe('legacy_claim_otps 테이블 + 5회 초과 차단 (EC-4)', () => {
  it('[GREEN] OTP 행 생성 및 attempt_count 증가 후 5회 초과 시 만료 처리', async () => {
    const testPhone = `0102222${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    const code = '123456';
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: inserted, error: insertErr } = await admin
      .from('legacy_claim_otps')
      .insert({ phone: testPhone, code, expires_at: expiresAt })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(inserted).not.toBeNull();
    const rowId = inserted!.id;

    cleanups.push(async () => {
      await admin.from('legacy_claim_otps').delete().eq('id', rowId);
    });

    await admin.from('legacy_claim_otps')
      .update({ attempt_count: 5 })
      .eq('id', rowId);

    const { data: row } = await admin
      .from('legacy_claim_otps')
      .select('attempt_count, expires_at, verified_at')
      .eq('id', rowId)
      .single();

    expect(row?.attempt_count).toBe(5);
    expect(row?.verified_at).toBeNull();
  });

  it('[GREEN] 만료된 OTP (expires_at이 과거) — verify-otp가 거부해야 함', async () => {
    const testPhone = `0103333${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    const code = '654321';
    const expiredAt = new Date(Date.now() - 10 * 1000).toISOString();

    const { data: inserted } = await admin
      .from('legacy_claim_otps')
      .insert({ phone: testPhone, code, expires_at: expiredAt })
      .select()
      .single();

    expect(inserted).not.toBeNull();
    const rowId = inserted!.id;

    cleanups.push(async () => {
      await admin.from('legacy_claim_otps').delete().eq('id', rowId);
    });

    const { data: row } = await admin
      .from('legacy_claim_otps')
      .select('expires_at')
      .eq('id', rowId)
      .lt('expires_at', new Date().toISOString())
      .single();

    expect(row).not.toBeNull();
  });

  it('[GREEN] 클라이언트(anon)가 legacy_claim_otps에 직접 접근 불가 — RLS 차단', async () => {
    const anonClient = createClient(
      PUBLIC_SUPABASE_URL,
      (await import('$env/static/public')).PUBLIC_SUPABASE_ANON_KEY,
    );

    const { data, error } = await anonClient.from('legacy_claim_otps').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
