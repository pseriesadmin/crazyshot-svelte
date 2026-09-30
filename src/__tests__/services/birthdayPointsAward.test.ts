import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * 생일 축하(birthday) 포인트 자동적립 TDD 통합테스트 — Migration #598
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/misty-scribbling-wand.md §3
 *
 * 정책: point_earn_rules.description 원문("생일 당월 자동 지급") 기준 — 생일이 속한
 * "달(月)"이 오늘과 같으면 그 달 안에 크론이 처음 만나는 날 1회만 지급(정확한 일자
 * 매칭 아님). 중복 방지는 user_id+연도 인조키.
 *
 * ⚠️ award_birthday_points_batch는 테이블 전체를 대상으로 조회하는 배치 RPC라, 이 테스트를
 * 충분히 큰 p_limit으로 호출하면 Stage DB에 실존하는(테스트용이 아닌) 회원 중 생일이 이번
 * 달인 사람에게도 실제로 포인트가 지급된다 — 이는 버그가 아니라 Stage가 "1차 검증" 환경으로
 * 의도된 정상 부작용이다(Production 배포 전 실제 동작을 그대로 확인하는 것이 이 테스트의
 * 목적). 테스트 자체는 ephemeral 테스트 계정만 생성/정리하며, 그 계정의 지급 기록만 검증한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const LARGE_LIMIT = 5000; // Stage 전체 회원 수(약 1천명대)보다 넉넉히 큰 값 — 배치 누락 없이 1회에 처리

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

async function createEphemeralUser(birthDate: string): Promise<string> {
  const email = `tdd-birthday-pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

  const { error: updErr } = await admin
    .from('user_profiles')
    .update({ birth_date: birthDate })
    .eq('user_id', userId);
  if (updErr) throw new Error(`birth_date 설정 실패: ${updErr.message}`);

  return userId;
}

async function getRule(): Promise<{ amount: number; is_active: boolean }> {
  const { data, error } = await admin
    .from('point_earn_rules')
    .select('amount, is_active')
    .eq('event_type', 'birthday')
    .single();
  if (error || !data) throw new Error(`birthday 규칙 조회 실패: ${error?.message}`);
  return data as { amount: number; is_active: boolean };
}

async function setRuleActive(isActive: boolean): Promise<void> {
  await admin.from('point_earn_rules').update({ is_active: isActive }).eq('event_type', 'birthday');
}

async function getPoints(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('points')
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error(`user_profiles 조회 실패: ${error?.message}`);
  return data.points as number;
}

interface BirthdayAwardRow { user_id: string; amount: number }

async function runBatch(): Promise<BirthdayAwardRow[]> {
  const { data, error } = await (admin.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: BirthdayAwardRow[] | null; error: { message: string } | null }>)(
    'award_birthday_points_batch',
    { p_limit: LARGE_LIMIT },
  );
  if (error) throw new Error(`award_birthday_points_batch 호출 실패: ${error.message}`);
  return data ?? [];
}

function thisMonthBirthDate(): string {
  const now = new Date();
  const y = now.getUTCFullYear() - 30; // 임의의 과거 출생연도
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-15`;
}

function otherMonthBirthDate(): string {
  const now = new Date();
  const y = now.getUTCFullYear() - 30;
  const otherMonth = ((now.getUTCMonth() + 6) % 12) + 1; // 정확히 6개월 차이나는 달
  const m = String(otherMonth).padStart(2, '0');
  return `${y}-${m}-15`;
}

describe('[TDD] award_birthday_points_batch 생일 축하 적립 — Migration #598', () => {
  it('① 생일이 이번 달인 회원은 적립 대상에 포함되고 실제로 지급된다', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }

    const userId = await createEphemeralUser(thisMonthBirthDate());
    const before = await getPoints(userId);

    const rows = await runBatch();
    const mine = rows.find((r) => r.user_id === userId);
    expect(mine).toBeTruthy();

    const rule = await getRule();
    expect(mine?.amount).toBe(rule.amount);

    const after = await getPoints(userId);
    expect(after - before).toBe(rule.amount);
  });

  it('② 생일이 이번 달이 아닌 회원은 적립 대상에서 제외된다', async () => {
    const userId = await createEphemeralUser(otherMonthBirthDate());
    const before = await getPoints(userId);

    const rows = await runBatch();
    expect(rows.find((r) => r.user_id === userId)).toBeUndefined();

    const after = await getPoints(userId);
    expect(after).toBe(before);
  });

  it('③ 같은 해에 두 번째로 배치를 돌려도 같은 회원에게 중복 지급되지 않는다', async () => {
    const userId = await createEphemeralUser(thisMonthBirthDate());

    const firstRows = await runBatch();
    expect(firstRows.find((r) => r.user_id === userId)).toBeTruthy();
    const afterFirst = await getPoints(userId);

    const secondRows = await runBatch();
    expect(secondRows.find((r) => r.user_id === userId)).toBeUndefined();
    const afterSecond = await getPoints(userId);

    expect(afterSecond).toBe(afterFirst);
  });

  it('④ birthday 규칙이 비활성이면 생일이 이번 달이어도 적립되지 않는다', async () => {
    const original = await getRule();
    await setRuleActive(false);
    cleanups.push(async () => { await setRuleActive(original.is_active); });

    const userId = await createEphemeralUser(thisMonthBirthDate());
    const before = await getPoints(userId);

    const rows = await runBatch();
    expect(rows.find((r) => r.user_id === userId)).toBeUndefined();

    const after = await getPoints(userId);
    expect(after).toBe(before);
  });
});
