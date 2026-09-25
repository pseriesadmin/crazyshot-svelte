import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient } from '@supabase/supabase-js';

/**
 * 구독 "혜택관리" 4종 실적용 마스터플랜 Phase 4/6 — 적립포인트(LOYALTY_POINTS) 적립 + 만료 (TDD)
 * award_subscription_points RPC — Migration 539
 * expire_due_points RPC — Migration 540 (point_transactions.expires_at 컬럼, Migration 538)
 *
 * ⚠️ 두 RPC 모두 REVOKE ALL ... GRANT service_role 전용이라 반드시 adminClient(service role)로만
 * 호출한다(subscriptionBenefitCouponIssuance.test.ts와 동일 패턴).
 *
 * 범위(B-START):
 *   정상 동작(적립) — LOYALTY_POINTS 혜택이 켜진 플랜의 구독자에게 결제 성공 시
 *     points_rate에 따라 계산된 포인트가 실제로 적립되고, point_transactions에 type='earn'
 *     행이 expires_at과 함께 기록된다.
 *   정상 동작(만료) — expires_at이 지난 미사용 적립분만 FIFO로 만료 처리되며, 이미 사용된
 *     부분은 이중으로 차감되지 않는다.
 *   막아야 할 것 — 혜택이 꺼져있거나 설정되지 않은 플랜, min_purchase_amount 미달, 존재하지
 *     않는 구독, 같은 날 중복 적립에는 포인트가 지급되면 안 된다. 만료 처리는 이미 사용된
 *     포인트나 아직 만료되지 않은 적립분을 건드리면 안 된다.
 *   실패했을 때 — 각 차단 케이스는 예외를 던지지 않고 { issued: false, reason: ... } JSONB를
 *     반환한다(호출부 chargeSubscription.ts가 fail-soft로 소비하는 계약과 일치).
 *
 * ⛔ 이번 세션은 stage 마이그레이션 미적용 상태(RPC 자체가 아직 없음) — 아래 테스트는 전부
 * RED(함수 없음 42883 에러 또는 그에 준하는 실패)로 먼저 확인하는 것이 정상이다. 메인 세션이
 * Migration 538/539/540을 stage에 적용한 뒤 재실행하면 GREEN으로 전환되어야 한다.
 */

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

type RpcResult = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const adminRpcCall = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

const TEST_USER_COUNT = 10;
let testUserIds: string[] = [];
let originalPoints: Record<string, number> = {};

// 플랜 — 각각 다른 LOYALTY_POINTS 혜택 구성 (적립 시나리오 ①~⑤)
let planNormal: number; // rate=5%, min=1000, max=100000, expiry=30일
let planMinNotMet: number; // rate=5%, min=50000
let planMaxClamp: number; // rate=50%, max=1000(클램프 테스트)
let planDuplicate: number; // rate=5%, min=0(같은날 중복호출 테스트)
let planDisabled: number; // is_enabled=false
let planNoBenefit: number; // tier_benefits 행 자체 없음
let planZero: number; // rate=1%, 매우 작은 결제금액으로 0포인트 유도

// 만료 시나리오(⑥~⑨) 전용 — rate=100%로 계산을 단순화(적립액 = 결제액)
let planExpire: number;

// 구독(user_subscriptions)
let subNormal: number;
let subMinNotMet: number;
let subMaxClamp: number;
let subDuplicate: number;
let subDisabled: number;
let subNoBenefit: number;
let subZero: number;
let subExpireFull: number; // ⑥
let subExpirePartial: number; // ⑦⑧
let subFifo: number; // ⑨

const createdPointTxIds: string[] = [];

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');

  const { data: userRows, error: userError } = await adminClient
    .from('user_profiles')
    .select('id, points')
    .order('id', { ascending: true })
    .limit(TEST_USER_COUNT);
  if (userError || !userRows || userRows.length < TEST_USER_COUNT) {
    throw new Error(`테스트용 user_profiles 픽스처 부족(최소 ${TEST_USER_COUNT}건 필요) — 스테이지 DB 상태 확인 필요`);
  }
  const rows = userRows as { id: string; points: number }[];
  testUserIds = rows.map((r) => r.id);
  originalPoints = Object.fromEntries(rows.map((r) => [r.id, r.points]));

  const makePlan = async (name: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('subscription_plans')
      .insert({ name: `__TEST_POINTS_${name}_${Date.now()}`, monthly_price: 9900, status: 'active' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`플랜(${name}) 픽스처 생성 실패: ${error?.message}`);
    return (data as { id: number }).id;
  };

  planNormal = await makePlan('NORMAL');
  planMinNotMet = await makePlan('MINNOTMET');
  planMaxClamp = await makePlan('MAXCLAMP');
  planDuplicate = await makePlan('DUPLICATE');
  planDisabled = await makePlan('DISABLED');
  planNoBenefit = await makePlan('NOBENEFIT');
  planZero = await makePlan('ZERO');
  planExpire = await makePlan('EXPIRE');

  const insertBenefit = async (planId: number, isEnabled: boolean, params: Record<string, number>) => {
    const { error } = await adminClient!.from('tier_benefits').insert({
      plan_id: planId,
      benefit_type: 'LOYALTY_POINTS',
      is_enabled: isEnabled,
      benefit_params: params,
    });
    if (error) throw new Error(`tier_benefits 픽스처 생성 실패(plan_id=${planId}): ${error.message}`);
  };

  await insertBenefit(planNormal, true, { points_rate: 5, min_purchase_amount: 1000, max_points_per_order: 100000, points_expiry_days: 30 });
  await insertBenefit(planMinNotMet, true, { points_rate: 5, min_purchase_amount: 50000, max_points_per_order: 100000, points_expiry_days: 30 });
  await insertBenefit(planMaxClamp, true, { points_rate: 50, min_purchase_amount: 0, max_points_per_order: 1000, points_expiry_days: 30 });
  await insertBenefit(planDuplicate, true, { points_rate: 5, min_purchase_amount: 0, max_points_per_order: 100000, points_expiry_days: 30 });
  await insertBenefit(planDisabled, false, { points_rate: 5, min_purchase_amount: 0, max_points_per_order: 100000, points_expiry_days: 30 });
  // planNoBenefit — tier_benefits 행 없음(의도적으로 insertBenefit 호출 안 함)
  await insertBenefit(planZero, true, { points_rate: 1, min_purchase_amount: 0, max_points_per_order: 100000, points_expiry_days: 30 });
  await insertBenefit(planExpire, true, { points_rate: 100, min_purchase_amount: 0, max_points_per_order: 10000000, points_expiry_days: 365 });

  const makeSub = async (planId: number, userId: string, suffix: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        plan_id: planId,
        status: 'active',
        billing_key: `billing_POINTS_TEST_${Date.now()}_${suffix}`,
        billing_cycle_day: 1,
        fail_count: 0,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`user_subscriptions 픽스처 생성 실패(${suffix}): ${error?.message}`);
    return (data as { id: number }).id;
  };

  subNormal = await makeSub(planNormal, testUserIds[0], 'normal');
  subMinNotMet = await makeSub(planMinNotMet, testUserIds[1], 'minnotmet');
  subMaxClamp = await makeSub(planMaxClamp, testUserIds[2], 'maxclamp');
  subDuplicate = await makeSub(planDuplicate, testUserIds[3], 'duplicate');
  subDisabled = await makeSub(planDisabled, testUserIds[4], 'disabled');
  subNoBenefit = await makeSub(planNoBenefit, testUserIds[5], 'nobenefit');
  subZero = await makeSub(planZero, testUserIds[6], 'zero');
  subExpireFull = await makeSub(planExpire, testUserIds[7], 'expirefull');
  subExpirePartial = await makeSub(planExpire, testUserIds[8], 'expirepartial');
  subFifo = await makeSub(planExpire, testUserIds[9], 'fifo');
});

afterAll(async () => {
  if (!adminClient) return;

  // FK 의존 순서: point_transactions(사용자 기준 삭제) → user_profiles.points 원복 →
  // user_subscriptions → tier_benefits → subscription_plans
  if (testUserIds.length > 0) {
    await adminClient
      .from('point_transactions')
      .delete()
      .in('user_id', testUserIds)
      .in('ref_type', ['subscription_points', 'point_expiry']);
  }

  for (const userId of testUserIds) {
    const original = originalPoints[userId];
    if (typeof original === 'number') {
      await adminClient.from('user_profiles').update({ points: original }).eq('id', userId);
    }
  }

  const allSubIds = [
    subNormal, subMinNotMet, subMaxClamp, subDuplicate, subDisabled,
    subNoBenefit, subZero, subExpireFull, subExpirePartial, subFifo,
  ].filter(Boolean);
  if (allSubIds.length > 0) {
    await adminClient.from('user_subscriptions').delete().in('id', allSubIds);
  }

  const allPlanIds = [
    planNormal, planMinNotMet, planMaxClamp, planDuplicate, planDisabled,
    planNoBenefit, planZero, planExpire,
  ].filter(Boolean);
  if (allPlanIds.length > 0) {
    await adminClient.from('tier_benefits').delete().in('plan_id', allPlanIds);
    await adminClient.from('subscription_plans').delete().in('id', allPlanIds);
  }
});

// ── 적립(award_subscription_points) ──────────────────────────────────────

describe('award_subscription_points — 정상 적립 (Happy)', () => {
  it('① RED: LOYALTY_POINTS 혜택이 켜진 구독은 결제금액×적립률만큼 포인트가 적립된다', async () => {
    const before = originalPoints[testUserIds[0]];
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subNormal,
      p_amount: 10000,
    });

    expect(error).toBeNull();
    expect(data?.issued).toBe(true);
    expect(data?.amount).toBe(500); // 10000 * 5% = 500
    expect(data?.new_balance).toBe(before + 500);

    const { data: profileRow } = await adminClient!
      .from('user_profiles')
      .select('points')
      .eq('id', testUserIds[0])
      .single();
    expect((profileRow as { points: number }).points).toBe(before + 500);

    const { data: txRows } = await adminClient!
      .from('point_transactions')
      .select('id, type, amount, ref_type, expires_at')
      .eq('user_id', testUserIds[0])
      .eq('ref_type', 'subscription_points')
      .order('created_at', { ascending: false })
      .limit(1);
    const tx = (txRows ?? [])[0] as { id: string; type: string; amount: number; expires_at: string } | undefined;
    expect(tx).toBeTruthy();
    expect(tx?.type).toBe('earn');
    expect(tx?.amount).toBe(500);
    createdPointTxIds.push(tx!.id);

    // expires_at ≈ now + 30일(±1시간 오차 허용)
    const expiresAt = new Date(tx!.expires_at).getTime();
    const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60 * 60 * 1000);
  });
});

describe('award_subscription_points — 차단 케이스 (Edge/Error)', () => {
  it('② RED: 최소 적립 기준금액 미달이면 적립되지 않는다', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subMinNotMet,
      p_amount: 10000, // min_purchase_amount=50000 미달
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('MIN_PURCHASE_NOT_MET');
  });

  it('③ RED: 계산값이 1회 최대 적립 포인트를 초과하면 상한값으로 클램프된다', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subMaxClamp,
      p_amount: 100000, // 100000 * 50% = 50000 → max_points_per_order=1000으로 클램프
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(true);
    expect(data?.amount).toBe(1000);
  });

  it('④ RED: 같은 구독의 같은 날 재호출은 중복적립되지 않는다', async () => {
    const first = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subDuplicate,
      p_amount: 10000,
    });
    expect(first.error).toBeNull();
    expect(first.data?.issued).toBe(true);

    const second = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subDuplicate,
      p_amount: 10000,
    });
    expect(second.error).toBeNull();
    expect(second.data?.issued).toBe(false);
    expect(second.data?.reason).toBe('ALREADY_GRANTED_TODAY');

    // 실제로 1건만 적립됐는지(2건이면 중복방지 로직이 무력화된 것)
    const { data: txRows } = await adminClient!
      .from('point_transactions')
      .select('id')
      .eq('user_id', testUserIds[3])
      .eq('ref_type', 'subscription_points');
    expect((txRows ?? []).length).toBe(1);
  });

  it('⑤a RED: 혜택이 꺼져있으면(is_enabled=false) 적립되지 않는다', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subDisabled,
      p_amount: 10000,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED');
  });

  it('⑤b RED: tier_benefits 행 자체가 없는 플랜은 적립되지 않는다', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subNoBenefit,
      p_amount: 10000,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED');
  });

  it('RED: 존재하지 않는 구독 id는 SUBSCRIPTION_NOT_FOUND를 반환한다(예외를 던지지 않음)', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: -999999,
      p_amount: 10000,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('RED: 계산 결과가 0포인트면 ZERO_POINTS로 차단된다', async () => {
    const { data, error } = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subZero,
      p_amount: 1, // 1 * 1% = 0.01 → round() = 0
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('ZERO_POINTS');
  });
});

// ── 만료(expire_due_points) — FIFO 재생 검증 ────────────────────────────────

describe('expire_due_points — FIFO 만료 처리 (핵심 검증)', () => {
  it('⑥ RED: 미사용 적립분은 expires_at 경과 후 전액 만료된다', async () => {
    const userId = testUserIds[7];
    const before = originalPoints[userId];

    const earnResult = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subExpireFull,
      p_amount: 10000, // rate=100% → 10000포인트 적립
    });
    expect(earnResult.data?.issued).toBe(true);
    expect(earnResult.data?.amount).toBe(10000);

    const { data: txRows } = await adminClient!
      .from('point_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('ref_type', 'subscription_points')
      .order('created_at', { ascending: false })
      .limit(1);
    const earnTxId = (txRows ?? [])[0]?.id as string;
    expect(earnTxId).toBeTruthy();
    createdPointTxIds.push(earnTxId);

    // 강제로 과거 만료시점으로 조작(하루 전)
    await adminClient!
      .from('point_transactions')
      .update({ expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', earnTxId);

    const { data: expireResult, error: expireError } = await adminRpcCall('expire_due_points', {});
    expect(expireError).toBeNull();
    expect((expireResult?.total_expired as number) ?? 0).toBeGreaterThanOrEqual(10000);

    const { data: profileRow } = await adminClient!
      .from('user_profiles')
      .select('points')
      .eq('id', userId)
      .single();
    expect((profileRow as { points: number }).points).toBe(before); // 10000 적립 - 10000 만료 = 원위치

    const { data: expireTxRows } = await adminClient!
      .from('point_transactions')
      .select('amount, type, ref_type, ref_id')
      .eq('user_id', userId)
      .eq('type', 'expire');
    const expireTx = (expireTxRows ?? []).find((r) => (r as { ref_id: string }).ref_id === earnTxId) as
      | { amount: number; ref_type: string }
      | undefined;
    expect(expireTx).toBeTruthy();
    expect(expireTx?.amount).toBe(-10000);
    expect(expireTx?.ref_type).toBe('point_expiry');
  });

  it('⑦⑧ RED: 부분 사용된 적립분은 남은 잔량만 만료되고(이중차감 없음), 재호출해도 추가로 차감되지 않는다(멱등성)', async () => {
    const userId = testUserIds[8];
    const before = originalPoints[userId];

    const earnResult = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subExpirePartial,
      p_amount: 10000, // rate=100% → 10000포인트 적립
    });
    expect(earnResult.data?.issued).toBe(true);

    const { data: txRows } = await adminClient!
      .from('point_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('ref_type', 'subscription_points')
      .order('created_at', { ascending: false })
      .limit(1);
    const earnTxId = (txRows ?? [])[0]?.id as string;
    createdPointTxIds.push(earnTxId);

    // 10000 중 6000 사용
    const useResult = await adminRpcCall('use_points', {
      p_user_id: userId,
      p_points: 6000,
      p_order_id: null,
    });
    expect(useResult.error).toBeNull();
    expect(useResult.data?.ok).toBe(true);

    // 강제로 과거 만료시점으로 조작
    await adminClient!
      .from('point_transactions')
      .update({ expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', earnTxId);

    const first = await adminRpcCall('expire_due_points', {});
    expect(first.error).toBeNull();

    const { data: afterFirst } = await adminClient!
      .from('user_profiles')
      .select('points')
      .eq('id', userId)
      .single();
    // 10000 적립 - 6000 사용 - 4000(잔여분만) 만료 = 원위치(6000 사용분은 이중차감되지 않음)
    expect((afterFirst as { points: number }).points).toBe(before);

    const { data: expireTxRows } = await adminClient!
      .from('point_transactions')
      .select('amount, ref_id')
      .eq('user_id', userId)
      .eq('type', 'expire');
    const expireTx = (expireTxRows ?? []).find((r) => (r as { ref_id: string }).ref_id === earnTxId) as
      | { amount: number }
      | undefined;
    expect(expireTx?.amount).toBe(-4000); // 10000 - 6000 = 4000만 만료(-10000이면 이중차감 버그)

    // ⑧ 멱등성 — 동일 상태에서 2회 연속 호출해도 추가로 깎이지 않는다
    const second = await adminRpcCall('expire_due_points', {});
    expect(second.error).toBeNull();

    const { data: afterSecond } = await adminClient!
      .from('user_profiles')
      .select('points')
      .eq('id', userId)
      .single();
    expect((afterSecond as { points: number }).points).toBe(before);

    const { data: expireTxRowsAfter } = await adminClient!
      .from('point_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'expire')
      .eq('ref_id', earnTxId);
    expect((expireTxRowsAfter ?? []).length).toBe(1); // 재호출로 추가 expire 행이 생기지 않아야 함
  });

  it('⑨ RED: 두 개의 적립 lot이 있을 때 오래된 lot부터 소진된다(FIFO 순서)', async () => {
    const userId = testUserIds[9];
    const before = originalPoints[userId];

    // lot1(오래된 것) — RPC 경유
    const lot1Result = await adminRpcCall('award_subscription_points', {
      p_user_subscription_id: subFifo,
      p_amount: 3000, // rate=100% → 3000
    });
    expect(lot1Result.data?.issued).toBe(true);

    const { data: lot1Rows } = await adminClient!
      .from('point_transactions')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('ref_type', 'subscription_points')
      .order('created_at', { ascending: false })
      .limit(1);
    const lot1TxId = (lot1Rows ?? [])[0]?.id as string;
    createdPointTxIds.push(lot1TxId);

    // lot2(더 최근 것) — 같은 날 중복적립 방지(ALREADY_GRANTED_TODAY)를 피하기 위해
    // RPC를 다시 호출하지 않고 point_transactions에 직접 삽입 + user_profiles.points를
    // 동일하게 수동 반영(award_subscription_points의 원자적 갱신을 그대로 흉내)
    await new Promise((resolve) => setTimeout(resolve, 10)); // created_at 순서 보장
    const { data: lot2Row, error: lot2Error } = await adminClient!
      .from('point_transactions')
      .insert({
        user_id: userId,
        type: 'earn',
        amount: 2000,
        balance_after: before + 3000 + 2000,
        description: '__TEST__ lot2 direct insert',
        ref_type: 'subscription_points',
        ref_id: `${subFifo}:manual-lot2`,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 아직 만료 안 됨
      })
      .select('id')
      .single();
    expect(lot2Error).toBeNull();
    const lot2TxId = (lot2Row as { id: string }).id;
    createdPointTxIds.push(lot2TxId);
    await adminClient!.from('user_profiles').update({ points: before + 3000 + 2000 }).eq('id', userId);

    // 1000 사용 — FIFO상 lot1(오래된 것)부터 소진되어야 함
    const useResult = await adminRpcCall('use_points', {
      p_user_id: userId,
      p_points: 1000,
      p_order_id: null,
    });
    expect(useResult.data?.ok).toBe(true);

    // lot1만 과거로 만료(잔여 2000), lot2는 미래 그대로 유지
    await adminClient!
      .from('point_transactions')
      .update({ expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', lot1TxId);

    const { error: expireError } = await adminRpcCall('expire_due_points', {});
    expect(expireError).toBeNull();

    const { data: profileRow } = await adminClient!
      .from('user_profiles')
      .select('points')
      .eq('id', userId)
      .single();
    // 3000(lot1) + 2000(lot2) - 1000(사용, lot1에서 우선 소진) - 2000(lot1 잔여 만료) = 2000(lot2만 남음)
    expect((profileRow as { points: number }).points).toBe(before + 2000);

    const { data: expireTxRows } = await adminClient!
      .from('point_transactions')
      .select('amount, ref_id')
      .eq('user_id', userId)
      .eq('type', 'expire');
    const lot1Expire = (expireTxRows ?? []).find((r) => (r as { ref_id: string }).ref_id === lot1TxId) as
      | { amount: number }
      | undefined;
    const lot2Expire = (expireTxRows ?? []).find((r) => (r as { ref_id: string }).ref_id === lot2TxId);
    expect(lot1Expire?.amount).toBe(-2000); // lot1: 3000 - 1000(사용) = 2000 잔여 → 전액 만료
    expect(lot2Expire).toBeUndefined(); // lot2는 아직 만료시점 전이라 손대면 안 됨
  });
});
