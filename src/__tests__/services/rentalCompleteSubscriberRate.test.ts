import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * 렌탈완료(rental_complete) 적립 — 구독회원 "더블 적립"(공통 규칙 + 구독료 결제 적립률 추가
 * 지급) TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/misty-scribbling-wand.md (2026-10-01 정정 반영)
 *
 * 배경: CMS "등급별 배수" 표시가 실제로 아무 RPC도 적용하지 않는 죽은 값이었던 문제를
 * Stephen이 최종 확정한 정책으로 해소(Migration #603):
 *   ① 일반 회원 — 공통 규칙 그대로 적용(무변경)
 *   ② 구독회원 — 공통 규칙 "모두" 그대로 적용 + 구독료 결제 적립(tier_benefits.LOYALTY_POINTS)
 *      과 동일한 비율만큼 추가 지급("더블 적립" — 별도 신규 혜택종류를 만들지 않고 기존
 *      "적립포인트" 혜택 값을 재사용)
 *   ③ 공통 규칙 is_active와 구독보너스(tier_benefits.is_enabled)는 완전히 독립적으로 작동
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다. award_rental_complete_points RPC(service_role 전용)를 admin 클라이언트로
 * 직접 호출한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const EASY_PLAN_ID = 448; // 실존 구독상품(Easy pack) — 테스트 종료 시 tier_benefits 행만 원복

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-rentalsub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/** rental_reservations + orders + order_items(line_total)를 함께 만들어 예약 id를 반환한다. */
async function createReservationWithLineTotal(
  userId: string,
  childProductId: string,
  lineTotal: number,
): Promise<number> {
  const { data: rr, error: rrErr } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: childProductId,
      start_date: '2099-01-01',
      end_date: '2099-01-03',
      status: 'returned',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (rrErr || !rr) throw new Error(`reservation 생성 실패: ${rrErr?.message}`);
  const reservationId = rr.id as number;
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId); });

  const orderKey = `TDD-RENTALSUB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      order_key: orderKey,
      user_id: userId,
      total_amount: lineTotal,
      final_amount: lineTotal,
    })
    .select('id')
    .single();
  if (orderErr || !order) throw new Error(`order 생성 실패: ${orderErr?.message}`);
  const orderId = order.id as number;
  cleanups.push(async () => { await admin.from('orders').delete().eq('id', orderId); });

  const { error: itemErr } = await admin
    .from('order_items')
    .insert({
      order_id: orderId,
      reservation_id: reservationId,
      product_id: childProductId,
      quantity: 1,
      unit_price: lineTotal,
      line_total: lineTotal,
    });
  if (itemErr) throw new Error(`order_item 생성 실패: ${itemErr.message}`);
  cleanups.push(async () => { await admin.from('order_items').delete().eq('reservation_id', reservationId); });

  return reservationId;
}

async function setActiveSubscription(userId: string, planId: number): Promise<void> {
  const { error } = await admin.from('user_subscriptions').insert({
    user_id: userId,
    plan_id: planId,
    status: 'active',
    started_at: new Date().toISOString(),
  });
  if (error) throw new Error(`user_subscriptions 생성 실패: ${error.message}`);
  cleanups.push(async () => {
    await admin.from('user_subscriptions').delete().eq('user_id', userId).eq('plan_id', planId);
  });
}

interface LoyaltyPointsParams {
  points_rate: number;
  min_purchase_amount?: number;
  max_points_per_order?: number | null;
  points_expiry_days?: number;
  is_stackable?: boolean;
}

/** plan_id의 기존 LOYALTY_POINTS 행을 백업해두고, 테스트 종료 시 원래 값으로 복원한다. */
async function withLoyaltyPoints(planId: number, isEnabled: boolean, params: LoyaltyPointsParams): Promise<void> {
  const { data: original } = await admin
    .from('tier_benefits')
    .select('is_enabled, benefit_params')
    .eq('plan_id', planId)
    .eq('benefit_type', 'LOYALTY_POINTS')
    .maybeSingle();

  const { error } = await admin.from('tier_benefits').upsert(
    { plan_id: planId, benefit_type: 'LOYALTY_POINTS', is_enabled: isEnabled, benefit_params: params },
    { onConflict: 'plan_id,benefit_type' },
  );
  if (error) throw new Error(`tier_benefits 저장 실패: ${error.message}`);

  cleanups.push(async () => {
    if (original) {
      await admin.from('tier_benefits')
        .update({ is_enabled: original.is_enabled, benefit_params: original.benefit_params })
        .eq('plan_id', planId).eq('benefit_type', 'LOYALTY_POINTS');
    } else {
      await admin.from('tier_benefits').delete().eq('plan_id', planId).eq('benefit_type', 'LOYALTY_POINTS');
    }
  });
}

async function getRule(): Promise<{ rate: number; is_active: boolean }> {
  const { data, error } = await admin
    .from('point_earn_rules')
    .select('rate, is_active')
    .eq('event_type', 'rental_complete')
    .single();
  if (error || !data) throw new Error(`rental_complete 규칙 조회 실패: ${error?.message}`);
  return data as { rate: number; is_active: boolean };
}

async function setRuleActive(isActive: boolean): Promise<void> {
  await admin.from('point_earn_rules').update({ is_active: isActive }).eq('event_type', 'rental_complete');
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

async function awardRentalComplete(reservationId: number) {
  return (admin.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)(
    'award_rental_complete_points',
    { p_reservation_id: reservationId },
  );
}

describe('[TDD] award_rental_complete_points 구독회원 더블 적립 — Migration #603', () => {
  it('① 일반(비구독) 회원 — 기존 공통 규칙(point_earn_rules.rate)만 적용된다(무회귀)', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }
    const rule = await getRule();

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const lineTotal = 100000;
    const reservationId = await createReservationWithLineTotal(userId, childId, lineTotal);

    const before = await getPoints(userId);
    const { data, error } = await awardRentalComplete(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.bonus_amount).toBe(0);

    const after = await getPoints(userId);
    expect(after - before).toBe(Math.round(lineTotal * rule.rate));
  });

  it('② 구독회원 — 공통 규칙 적립분 + 구독료 결제 적립률만큼 추가 적립(더블 적립)', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }
    const rule = await getRule();

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const lineTotal = 100000;
    const reservationId = await createReservationWithLineTotal(userId, childId, lineTotal);

    await setActiveSubscription(userId, EASY_PLAN_ID);
    await withLoyaltyPoints(EASY_PLAN_ID, true, { points_rate: 5, min_purchase_amount: 0, max_points_per_order: null, points_expiry_days: 365 });

    const before = await getPoints(userId);
    const { data, error } = await awardRentalComplete(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    const expectedCommon = Math.round(lineTotal * rule.rate);
    const expectedBonus = Math.round(lineTotal * 0.05);
    expect(data?.common_amount).toBe(expectedCommon);
    expect(data?.bonus_amount).toBe(expectedBonus);
    expect(data?.amount).toBe(expectedCommon + expectedBonus);

    const after = await getPoints(userId);
    expect(after - before).toBe(expectedCommon + expectedBonus);
  });

  it('③ 구독회원인데 구독료 결제 적립(LOYALTY_POINTS)이 비활성 — 보너스 없이 공통분만 적립(공통규칙으로 대체되지 않음)', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }
    const rule = await getRule();

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const lineTotal = 100000;
    const reservationId = await createReservationWithLineTotal(userId, childId, lineTotal);

    await setActiveSubscription(userId, EASY_PLAN_ID);
    await withLoyaltyPoints(EASY_PLAN_ID, false, { points_rate: 5 }); // 비활성

    const before = await getPoints(userId);
    const { data, error } = await awardRentalComplete(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.bonus_amount).toBe(0);
    expect(data?.common_amount).toBe(Math.round(lineTotal * rule.rate));

    const after = await getPoints(userId);
    expect(after - before).toBe(Math.round(lineTotal * rule.rate));
  });

  it('④ 공통 "렌탈 완료" 규칙을 비활성화해도 구독회원 보너스는 독립적으로 계속 지급된다', async () => {
    const original = await getRule();
    await setRuleActive(false);
    cleanups.push(async () => { await setRuleActive(original.is_active); });

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const lineTotal = 100000;
    const reservationId = await createReservationWithLineTotal(userId, childId, lineTotal);

    await setActiveSubscription(userId, EASY_PLAN_ID);
    await withLoyaltyPoints(EASY_PLAN_ID, true, { points_rate: 4, min_purchase_amount: 0, max_points_per_order: null, points_expiry_days: 365 });

    const { data, error } = await awardRentalComplete(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.common_amount).toBe(0);
    expect(data?.bonus_amount).toBe(Math.round(lineTotal * 0.04));
    expect(data?.amount).toBe(Math.round(lineTotal * 0.04));
  });

  it('⑤ 멱등성: 같은 예약에 두 번 호출해도 공통분·보너스분 모두 중복 지급되지 않는다', async () => {
    const original = await getRule();
    if (!original.is_active) {
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(false); });
    }

    const userId = await createEphemeralUser();
    const childId = await pickChildProduct();
    const reservationId = await createReservationWithLineTotal(userId, childId, 100000);

    await setActiveSubscription(userId, EASY_PLAN_ID);
    await withLoyaltyPoints(EASY_PLAN_ID, true, { points_rate: 5, min_purchase_amount: 0, max_points_per_order: null, points_expiry_days: 365 });

    await awardRentalComplete(reservationId);
    const afterFirst = await getPoints(userId);

    const { data } = await awardRentalComplete(reservationId);
    expect(data?.already_granted).toBe(true);

    const afterSecond = await getPoints(userId);
    expect(afterSecond).toBe(afterFirst);
  });
});
