import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * 정시 반납(on_time_return) 포인트 자동적립 TDD 통합테스트 — Migration #597
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/misty-scribbling-wand.md §2
 *
 * 정책(Stephen 확정, 2026-09-30): 반납 예정일(end_date) 이전 또는 당일까지 반납 완료하면
 * 정시로 인정(조기 반납 포함). 예정일을 하루라도 넘기면 미지급.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다. award_on_time_return_points RPC(service_role 전용)를 admin 클라이언트로
 * 직접 호출한다(award_rental_complete_points와 동일하게 auth.uid() 불필요 — p_reservation_id
 * 파라미터로 대상을 특정).
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

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-ontime-pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });
  return userId;
}

async function pickChildProduct(): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .select('id')
    .not('parent_product_id', 'is', null)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error || !data) throw new Error(`테스트용 자식 상품 조회 실패: ${error?.message}`);
  return data.id as string;
}

async function createReservation(userId: string, childProductId: string, endDate: string): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: childProductId,
      start_date: endDate,
      end_date: endDate,
      status: 'in_use',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  const id = data.id as number;
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', id); });
  return id;
}

async function getRule(): Promise<{ amount: number; is_active: boolean }> {
  const { data, error } = await admin
    .from('point_earn_rules')
    .select('amount, is_active')
    .eq('event_type', 'on_time_return')
    .single();
  if (error || !data) throw new Error(`on_time_return 규칙 조회 실패: ${error?.message}`);
  return data as { amount: number; is_active: boolean };
}

async function setRuleActive(isActive: boolean): Promise<void> {
  await admin.from('point_earn_rules').update({ is_active: isActive }).eq('event_type', 'on_time_return');
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

function toDateStr(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function awardOnTime(reservationId: number) {
  return (admin.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)(
    'award_on_time_return_points',
    { p_reservation_id: reservationId },
  );
}

describe('[TDD] award_on_time_return_points 정시 반납 적립 — Migration #597', () => {
  it('① 반납 예정일 당일(오늘) 반납 처리 → 적립된다', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservation(userId, childId, toDateStr(0));

    const before = await getPoints(userId);
    const { data, error } = await awardOnTime(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    const after = await getPoints(userId);
    const rule = await getRule();
    expect(after - before).toBe(rule.amount);
  });

  it('② 반납 예정일 이전(조기 반납) → 정시로 인정해 적립된다', async () => {
    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservation(userId, childId, toDateStr(3)); // 예정일이 3일 뒤

    const before = await getPoints(userId);
    const { data, error } = await awardOnTime(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    const after = await getPoints(userId);
    expect(after).toBeGreaterThan(before);
  });

  it('③ 반납 예정일을 넘긴 경우(지연 반납) → 미지급(late_return)', async () => {
    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservation(userId, childId, toDateStr(-2)); // 예정일이 2일 지남

    const before = await getPoints(userId);
    const { data, error } = await awardOnTime(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toBe('late_return');

    const after = await getPoints(userId);
    expect(after).toBe(before);
  });

  it('④ 멱등성: 같은 예약에 두 번 호출해도 중복 지급되지 않는다', async () => {
    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservation(userId, childId, toDateStr(0));

    await awardOnTime(reservationId);
    const afterFirst = await getPoints(userId);

    const { data } = await awardOnTime(reservationId);
    expect(data?.already_granted).toBe(true);

    const afterSecond = await getPoints(userId);
    expect(afterSecond).toBe(afterFirst);
  });

  it('⑤ on_time_return 규칙이 비활성이면 정시 반납이어도 적립되지 않는다', async () => {
    const original = await getRule();
    await setRuleActive(false);
    cleanups.push(async () => { await setRuleActive(original.is_active); });

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservation(userId, childId, toDateStr(0));

    const before = await getPoints(userId);
    const { data, error } = await awardOnTime(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toBe('rule_inactive');

    const after = await getPoints(userId);
    expect(after).toBe(before);
  });
});
