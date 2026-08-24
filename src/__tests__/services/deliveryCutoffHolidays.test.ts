import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { loadCourierClosedDates } from '$lib/server/courierClosedDates';

/**
 * "배송 옵션 시스템 — 대여방식 고정 + 택배 휴무일 캘린더 제어" TDD 통합 테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * AGENTS.md "핵심 RPC" 목록의 check_delivery_deadline과 동일 개념(배송 마감/가능일 판정)에
 * 해당해 TDD 강제 도메인으로 분류됨 — 마이그레이션 333~336(supabase/migrations/) 대상.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다(couponLazySequencing.test.ts / holdExpiration.test.ts와 동일 패턴).
 *
 * 검증 항목:
 *   1. sync_national_holidays — upsert/멱등성/manual 행 보호/대체공휴일 정정(비활성화)/
 *      service_role 전용 권한(authenticated 호출 거부)
 *   2. upsert_delivery_cutoff_settings — 세션 없음·비CMS 사용자 거부, manager 이상 성공
 *   3. upsert_manual_holiday / delete_manual_holiday — manager 등록, national 날짜 충돌
 *      차단, 비CMS 사용자 거부, delete가 manual 행만 대상으로 하는지(national 행 보호)
 *   4. loadCourierClosedDates(cart/+page.server.ts) — 마스터 토글 OFF 시 완전 스킵, 전날/
 *      당일 비대칭 판정에 쓰이는 원본 날짜셋이 토글 조합별로 정확히 필터링되는지
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
  await resetCutoffSettings();
});

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────

// 일요일과 겹치면 national/manual 신호가 "일요일 반영" 신호와 뒤섞여 단언이 모호해지므로,
// 항상 일요일이 아닌 날짜를 반환한다.
function nonSundayDaysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 마스터 토글 ON 상태에서 loadCourierClosedDates가 계산하는 "다가오는 일요일" 중 하나를
// 동일한 방식(내일부터 최대 7일 이내)으로 계산해 반환 — 실제 로직과 동일 알고리즘이어야
// 어떤 날짜가 나와도 항상 유효한 기준점이 된다.
function upcomingSunday(): string {
  const d = new Date();
  for (let i = 1; i <= 7; i++) {
    const cand = new Date(d);
    cand.setDate(d.getDate() + i);
    if (cand.getDay() === 0) return cand.toISOString().slice(0, 10);
  }
  throw new Error('upcomingSunday 계산 실패');
}

// sync_national_holidays 테스트용 고정 동기화 범위 — 이 파일이 쓰는 오프셋(최대 246일)을
// 넉넉히 덮음(Migration 337 — 배치 데이터가 아닌 명시적 범위 파라미터로 정정 감지)
function testSyncRangeArgs(): { p_range_start: string; p_range_end: string } {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 400);
  return {
    p_range_start: start.toISOString().slice(0, 10),
    p_range_end: end.toISOString().slice(0, 10),
  };
}

async function insertHoliday(
  date: string,
  name: string,
  holidayType: 'national' | 'manual',
  note: string | null = null
): Promise<string> {
  const { data, error } = await (admin.from('public_holidays' as never) as unknown as {
    insert: (r: Record<string, unknown>) => {
      select: (s: string) => { single: () => Promise<RpcResult<{ id: string }>> };
    };
  })
    .insert({ date, name, country: 'KR', holiday_type: holidayType, note, is_active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`휴무일 픽스처 생성 실패: ${error?.message}`);
  cleanups.push(async () => {
    await admin.from('public_holidays').delete().eq('id', data.id);
  });
  return data.id;
}

async function resetCutoffSettings(): Promise<void> {
  const { data } = await admin
    .from('delivery_cutoff_settings')
    .select('id')
    .limit(1)
    .single();
  const row = data as { id: string } | null;
  if (row) {
    await admin
      .from('delivery_cutoff_settings')
      .update({
        enable_prev_day_check: false,
        enable_fixed_holidays: false,
        enable_manual_holidays: false,
      })
      .eq('id', row.id);
  }
}

async function setCutoffSettings(
  enablePrevDayCheck: boolean,
  enableFixedHolidays: boolean,
  enableManualHolidays: boolean
): Promise<void> {
  const { data } = await admin
    .from('delivery_cutoff_settings')
    .select('id')
    .limit(1)
    .single();
  const row = data as { id: string } | null;
  if (!row) throw new Error('delivery_cutoff_settings 싱글톤 행이 없습니다');
  const { error } = await admin
    .from('delivery_cutoff_settings')
    .update({
      enable_prev_day_check: enablePrevDayCheck,
      enable_fixed_holidays: enableFixedHolidays,
      enable_manual_holidays: enableManualHolidays,
    })
    .eq('id', row.id);
  if (error) throw new Error(`cutoff 설정 픽스처 실패: ${error.message}`);
}

// CMS 세션(role=null이면 cms_role 미설정 = 일반 회원) — is_cms_user() 게이트 RPC를
// 실제 인증 컨텍스트로 검증하기 위한 헬퍼(couponLazySequencing.test.ts의 ephemeral user
// 패턴을 signInWithPassword로 확장 — auth.uid()가 필요한 SECURITY DEFINER 함수는
// service_role 키만으로는 통과할 수 없어 실제 로그인 세션이 필요함)
async function createEphemeralSession(cmsRole: string | null): Promise<{
  client: SupabaseClient;
  userId: string;
  cleanup: () => Promise<void>;
}> {
  const email = `tdd-hol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;

  if (cmsRole) {
    const { error: profileErr } = await admin
      .from('user_profiles')
      .update({ cms_role: cmsRole })
      .eq('id', userId);
    if (profileErr) throw new Error(`cms_role 설정 실패: ${profileErr.message}`);
  }

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

// ── 1. sync_national_holidays ───────────────────────────────────────────────

describe('[TDD] sync_national_holidays — 법정공휴일 API 동기화 RPC', () => {
  it('신규 법정공휴일을 upsert하고 upserted 카운트를 반환한다', async () => {
    const date = nonSundayDaysFromNow(210);
    cleanups.push(async () => {
      await admin.from('public_holidays').delete().eq('date', date);
    });

    const { data, error } = await rpcCall<{ upserted: number }>(admin, 'sync_national_holidays', {
      p_holidays: [{ date, name: '테스트공휴일A' }],
      ...testSyncRangeArgs(),
    });

    expect(error).toBeNull();
    expect(data?.upserted).toBe(1);

    const { data: row } = await admin
      .from('public_holidays')
      .select('holiday_type, is_active, name')
      .eq('date', date)
      .single();
    expect(row).toMatchObject({ holiday_type: 'national', is_active: true, name: '테스트공휴일A' });
  });

  it('재실행 시 멱등적으로 갱신되고 중복 행을 만들지 않는다(대체공휴일 명칭 정정 등)', async () => {
    const date = nonSundayDaysFromNow(211);
    cleanups.push(async () => {
      await admin.from('public_holidays').delete().eq('date', date);
    });

    await rpcCall(admin, 'sync_national_holidays', { p_holidays: [{ date, name: '1차명칭' }], ...testSyncRangeArgs() });
    await rpcCall(admin, 'sync_national_holidays', { p_holidays: [{ date, name: '2차정정명칭' }], ...testSyncRangeArgs() });

    const { data: rows } = await admin.from('public_holidays').select('id, name').eq('date', date);
    expect((rows ?? []).length).toBe(1);
    expect((rows as { name: string }[] | null)?.[0]?.name).toBe('2차정정명칭');
  });

  it('동일 날짜에 이미 manual 행이 있으면 national으로 덮어쓰지 않는다', async () => {
    const date = nonSundayDaysFromNow(212);
    await insertHoliday(date, '관리자 임시휴무', 'manual', '명절 연휴');

    const { data } = await rpcCall<{ upserted: number }>(admin, 'sync_national_holidays', {
      p_holidays: [{ date, name: 'API가 보낸 국경일명' }],
      ...testSyncRangeArgs(),
    });
    expect(data?.upserted).toBe(0);

    const { data: row } = await admin
      .from('public_holidays')
      .select('holiday_type, note')
      .eq('date', date)
      .single();
    expect(row).toMatchObject({ holiday_type: 'manual', note: '명절 연휴' });
  });

  it('API 응답에 더 이상 없는 national 행은 입력 범위 내에서 비활성화된다', async () => {
    const dateA = nonSundayDaysFromNow(220);
    const dateB = nonSundayDaysFromNow(221);
    cleanups.push(async () => {
      await admin.from('public_holidays').delete().in('date', [dateA, dateB]);
    });

    await rpcCall(admin, 'sync_national_holidays', {
      p_holidays: [
        { date: dateA, name: 'A공휴일' },
        { date: dateB, name: 'B공휴일' },
      ],
      ...testSyncRangeArgs(),
    });

    // 재동기화 — B가 더 이상 응답에 없음(대체공휴일 정정 등으로 제외된 상황을 재현).
    // 동일한 명시적 범위(testSyncRangeArgs)를 그대로 전달해야 배치가 좁아져도 B가
    // 정정감지 대상에 남는다(Migration 337 핵심 — 배치 데이터가 아닌 범위 파라미터 기준).
    await rpcCall(admin, 'sync_national_holidays', {
      p_holidays: [{ date: dateA, name: 'A공휴일' }],
      ...testSyncRangeArgs(),
    });

    const { data: rows } = await admin
      .from('public_holidays')
      .select('date, is_active')
      .in('date', [dateA, dateB]);
    const byDate = new Map((rows as { date: string; is_active: boolean }[] | null)?.map((r) => [r.date, r.is_active]));
    expect(byDate.get(dateA)).toBe(true);
    expect(byDate.get(dateB)).toBe(false);
  });

  it('service_role이 아닌 인증 사용자는 이 RPC를 호출할 수 없다(EXECUTE 권한 없음)', async () => {
    const { client, cleanup } = await createEphemeralSession(null);
    cleanups.push(cleanup);

    const { error } = await rpcCall(client, 'sync_national_holidays', {
      p_holidays: [{ date: nonSundayDaysFromNow(213), name: '권한없음테스트' }],
      ...testSyncRangeArgs(),
    });
    expect(error).not.toBeNull();
  });
});

// ── 2. upsert_delivery_cutoff_settings ──────────────────────────────────────

describe('[TDD] upsert_delivery_cutoff_settings — 휴무일 제어 토글 3종', () => {
  it('세션 없이 호출하면 거부된다', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
    const { error } = await rpcCall(anon, 'upsert_delivery_cutoff_settings', {
      p_enable_prev_day_check: true,
      p_enable_fixed_holidays: true,
      p_enable_manual_holidays: true,
    });
    expect(error).not.toBeNull();
  });

  it('cms_role이 없는 일반 회원은 거부된다', async () => {
    const { client, cleanup } = await createEphemeralSession(null);
    cleanups.push(cleanup);

    const { error } = await rpcCall(client, 'upsert_delivery_cutoff_settings', {
      p_enable_prev_day_check: true,
      p_enable_fixed_holidays: true,
      p_enable_manual_holidays: true,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('CMS 권한');
  });

  it('manager 이상 CMS 사용자는 저장에 성공하고 값이 그대로 반영된다', async () => {
    const { client, cleanup } = await createEphemeralSession('manager');
    cleanups.push(cleanup);

    const { data, error } = await rpcCall<{
      enable_prev_day_check: boolean;
      enable_fixed_holidays: boolean;
      enable_manual_holidays: boolean;
    }>(client, 'upsert_delivery_cutoff_settings', {
      p_enable_prev_day_check: true,
      p_enable_fixed_holidays: true,
      p_enable_manual_holidays: false,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      enable_prev_day_check: true,
      enable_fixed_holidays: true,
      enable_manual_holidays: false,
    });

    const { data: row } = await admin
      .from('delivery_cutoff_settings')
      .select('enable_prev_day_check, enable_fixed_holidays, enable_manual_holidays')
      .limit(1)
      .single();
    expect(row).toMatchObject({
      enable_prev_day_check: true,
      enable_fixed_holidays: true,
      enable_manual_holidays: false,
    });
  });
});

// ── 3. upsert_manual_holiday / delete_manual_holiday ────────────────────────

describe('[TDD] upsert_manual_holiday / delete_manual_holiday — 임시 휴무일 CRUD', () => {
  it('manager는 임시휴무일을 등록할 수 있다', async () => {
    const { client, cleanup } = await createEphemeralSession('manager');
    cleanups.push(cleanup);
    const date = nonSundayDaysFromNow(230);
    cleanups.push(async () => {
      await admin.from('public_holidays').delete().eq('date', date);
    });

    const { data, error } = await rpcCall<{ id: string; holiday_type: string; note: string }>(
      client,
      'upsert_manual_holiday',
      { p_id: null, p_date: date, p_note: '창립기념일 임시휴무' }
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({ holiday_type: 'manual', note: '창립기념일 임시휴무' });
  });

  it('이미 법정공휴일로 등록된 날짜는 임시휴무일로 등록할 수 없다', async () => {
    const date = nonSundayDaysFromNow(231);
    await insertHoliday(date, '기존 법정공휴일', 'national');
    const { client, cleanup } = await createEphemeralSession('manager');
    cleanups.push(cleanup);

    const { error } = await rpcCall(client, 'upsert_manual_holiday', {
      p_id: null,
      p_date: date,
      p_note: '충돌 시도',
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('이미 법정공휴일');
  });

  it('cms_role이 없는 일반 회원은 등록·삭제 둘 다 거부된다', async () => {
    const { client, cleanup } = await createEphemeralSession(null);
    cleanups.push(cleanup);
    const date = nonSundayDaysFromNow(232);

    const { error: upsertErr } = await rpcCall(client, 'upsert_manual_holiday', {
      p_id: null,
      p_date: date,
      p_note: '권한없음',
    });
    expect(upsertErr).not.toBeNull();

    const { error: deleteErr } = await rpcCall(client, 'delete_manual_holiday', {
      p_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(deleteErr).not.toBeNull();
  });

  it('delete_manual_holiday는 national 행을 삭제하지 못하고 manual 행만 삭제한다', async () => {
    const nationalDate = nonSundayDaysFromNow(233);
    const nationalId = await insertHoliday(nationalDate, '보호대상 법정공휴일', 'national');
    const { client, cleanup } = await createEphemeralSession('manager');
    cleanups.push(cleanup);

    const { error: blockedErr } = await rpcCall(client, 'delete_manual_holiday', { p_id: nationalId });
    expect(blockedErr).not.toBeNull();
    expect(blockedErr?.message).toContain('삭제할 임시휴무일');

    const { data: stillThere } = await admin
      .from('public_holidays')
      .select('id')
      .eq('id', nationalId)
      .maybeSingle();
    expect(stillThere).not.toBeNull();

    // manual 행은 정상 삭제되어야 함
    const manualDate = nonSundayDaysFromNow(234);
    const { data: created } = await rpcCall<{ id: string }>(client, 'upsert_manual_holiday', {
      p_id: null,
      p_date: manualDate,
      p_note: '삭제될 임시휴무일',
    });
    const manualId = created?.id as string;

    const { error: deleteOkErr } = await rpcCall(client, 'delete_manual_holiday', { p_id: manualId });
    expect(deleteOkErr).toBeNull();

    const { data: gone } = await admin
      .from('public_holidays')
      .select('id')
      .eq('id', manualId)
      .maybeSingle();
    expect(gone).toBeNull();
  });
});

// ── 4. loadCourierClosedDates — /cart 캘린더 폐쇄일 계산 로직 ────────────────

describe('[TDD] loadCourierClosedDates — 마스터 토글·고정/임시 휴무일 조합 판정', () => {
  it('마스터 토글 OFF면 휴무일 데이터가 있어도 완전히 스킵하고 빈 배열을 반환한다', async () => {
    const date = nonSundayDaysFromNow(240);
    await insertHoliday(date, '스킵되어야 할 국경일', 'national');
    await setCutoffSettings(false, true, true);

    const closed = await loadCourierClosedDates(admin);
    expect(closed).toEqual([]);
  });

  it('마스터+고정휴무일 ON, 임시휴무일 OFF면 일요일·national만 포함하고 manual은 제외한다', async () => {
    const nationalDate = nonSundayDaysFromNow(241);
    const manualDate = nonSundayDaysFromNow(242);
    await insertHoliday(nationalDate, '국경일', 'national');
    await insertHoliday(manualDate, '임시휴무', 'manual');
    await setCutoffSettings(true, true, false);

    const closed = await loadCourierClosedDates(admin);
    expect(closed).toContain(nationalDate);
    expect(closed).toContain(upcomingSunday());
    expect(closed).not.toContain(manualDate);
  });

  it('마스터+임시휴무일 ON, 고정휴무일 OFF면 manual만 포함하고 national·일요일은 제외한다', async () => {
    const nationalDate = nonSundayDaysFromNow(243);
    const manualDate = nonSundayDaysFromNow(244);
    await insertHoliday(nationalDate, '국경일', 'national');
    await insertHoliday(manualDate, '임시휴무', 'manual');
    await setCutoffSettings(true, false, true);

    const closed = await loadCourierClosedDates(admin);
    expect(closed).toContain(manualDate);
    expect(closed).not.toContain(nationalDate);
    expect(closed).not.toContain(upcomingSunday());
  });

  it('마스터+고정+임시휴무일 전부 ON이면 national·manual·일요일 전부 포함된다', async () => {
    const nationalDate = nonSundayDaysFromNow(245);
    const manualDate = nonSundayDaysFromNow(246);
    await insertHoliday(nationalDate, '국경일', 'national');
    await insertHoliday(manualDate, '임시휴무', 'manual');
    await setCutoffSettings(true, true, true);

    const closed = await loadCourierClosedDates(admin);
    expect(closed).toContain(nationalDate);
    expect(closed).toContain(manualDate);
    expect(closed).toContain(upcomingSunday());
  });
});
