import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient } from '@supabase/supabase-js';

/**
 * 구독 "혜택관리" 4종 실적용 마스터플랜 Phase 3/6 — 할인쿠폰(DISCOUNT_COUPON) 자동발급 (TDD)
 * issue_subscription_benefit_coupon RPC — Migration 537
 *
 * ⚠️ 이 RPC는 REVOKE ALL ... GRANT service_role 전용이라 반드시 adminClient(service role)로만
 * 호출한다(subscriptionBilling.test.ts와 동일 패턴).
 *
 * 범위(B-START):
 *   정상 동작 — DISCOUNT_COUPON 혜택이 켜진 플랜의 구독자에게 결제 성공(청구 성공 분기) 시
 *     coupons/user_coupons에 실제로 쿠폰이 생성되고 discount_value가 benefit_params.
 *     coupon_amount와 일치한다.
 *   막아야 할 것 — 혜택이 꺼져있거나(is_enabled=false) 아예 설정되지 않은 플랜, coupon_amount
 *     가 0/누락인 설정, 존재하지 않는 구독, 월 발행횟수(coupon_frequency) 한도를 이미 채운
 *     구독에는 쿠폰이 생성되면 안 된다.
 *   실패했을 때 — 각 차단 케이스는 예외를 던지지 않고 { issued: false, reason: ... } JSONB를
 *     반환한다(호출부 chargeSubscription.ts가 fail-soft로 소비하는 계약과 일치).
 *
 * ⛔ 이번 세션은 stage 마이그레이션 미적용 상태(RPC 자체가 아직 없음) — 아래 테스트는 전부
 * RED(함수 없음 42883 에러 또는 그에 준하는 실패)로 먼저 확인하는 것이 정상이다. 메인 세션이
 * Migration 537을 stage에 적용한 뒤 재실행하면 GREEN으로 전환되어야 한다.
 */

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

type RpcResult = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const adminRpcCall = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

let testUserIds: string[] = [];

// 플랜 4종 — 각각 다른 혜택 구성
let planEnabled: number; // DISCOUNT_COUPON is_enabled=true, coupon_amount=5000, frequency=1
let planDisabled: number; // DISCOUNT_COUPON is_enabled=false
let planNoBenefit: number; // tier_benefits 행 자체 없음
let planInvalidAmount: number; // is_enabled=true, coupon_amount=0(무효)
let planFrequency: number; // is_enabled=true, coupon_frequency=1(월 1회 한도 테스트 전용)

// 구독(user_subscriptions) — 각 플랜당 1개
let subEnabled: number;
let subDisabled: number;
let subNoBenefit: number;
let subInvalidAmount: number;
let subFrequency: number;

const createdCouponIds: string[] = [];

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');

  const { data: userRows, error: userError } = await adminClient
    .from('user_profiles')
    .select('id')
    .order('id', { ascending: true })
    .limit(5);
  if (userError || !userRows || userRows.length < 5) {
    throw new Error('테스트용 user_profiles 픽스처 부족(최소 5건 필요) — 스테이지 DB 상태 확인 필요');
  }
  testUserIds = (userRows as { id: string }[]).map((r) => r.id);

  const makePlan = async (name: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('subscription_plans')
      .insert({ name: `__TEST_BENEFIT_${name}_${Date.now()}`, monthly_price: 9900, status: 'active' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`플랜(${name}) 픽스처 생성 실패: ${error?.message}`);
    return (data as { id: number }).id;
  };

  planEnabled = await makePlan('ENABLED');
  planDisabled = await makePlan('DISABLED');
  planNoBenefit = await makePlan('NOBENEFIT');
  planInvalidAmount = await makePlan('INVALIDAMOUNT');
  planFrequency = await makePlan('FREQUENCY');

  const insertBenefit = async (planId: number, isEnabled: boolean, params: Record<string, number>) => {
    const { error } = await adminClient!.from('tier_benefits').insert({
      plan_id: planId,
      benefit_type: 'DISCOUNT_COUPON',
      is_enabled: isEnabled,
      benefit_params: params,
    });
    if (error) throw new Error(`tier_benefits 픽스처 생성 실패(plan_id=${planId}): ${error.message}`);
  };

  await insertBenefit(planEnabled, true, { coupon_amount: 5000, coupon_frequency: 1, coupon_valid_days: 14 });
  await insertBenefit(planDisabled, false, { coupon_amount: 5000, coupon_frequency: 1, coupon_valid_days: 14 });
  // planNoBenefit — tier_benefits 행 없음(의도적으로 insertBenefit 호출 안 함)
  await insertBenefit(planInvalidAmount, true, { coupon_amount: 0, coupon_frequency: 1, coupon_valid_days: 14 });
  await insertBenefit(planFrequency, true, { coupon_amount: 3000, coupon_frequency: 1, coupon_valid_days: 7 });

  const makeSub = async (planId: number, userId: string, suffix: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        plan_id: planId,
        status: 'active',
        billing_key: `billing_BENEFIT_TEST_${Date.now()}_${suffix}`,
        billing_cycle_day: 1,
        fail_count: 0,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`user_subscriptions 픽스처 생성 실패(${suffix}): ${error?.message}`);
    return (data as { id: number }).id;
  };

  subEnabled = await makeSub(planEnabled, testUserIds[0], 'enabled');
  subDisabled = await makeSub(planDisabled, testUserIds[1], 'disabled');
  subNoBenefit = await makeSub(planNoBenefit, testUserIds[2], 'nobenefit');
  subInvalidAmount = await makeSub(planInvalidAmount, testUserIds[3], 'invalidamount');
  subFrequency = await makeSub(planFrequency, testUserIds[4], 'frequency');
});

afterAll(async () => {
  if (!adminClient) return;

  // FK 의존 순서: subscription_benefit_usage → user_coupons → coupons →
  // (tier_benefits/user_subscriptions는 서로 무관) → subscription_plans
  const allSubIds = [subEnabled, subDisabled, subNoBenefit, subInvalidAmount, subFrequency].filter(Boolean);
  if (allSubIds.length > 0) {
    await adminClient.from('subscription_benefit_usage').delete().in('user_subscription_id', allSubIds);
  }
  if (createdCouponIds.length > 0) {
    await adminClient.from('user_coupons').delete().in('coupon_id', createdCouponIds);
    await adminClient.from('coupons').delete().in('id', createdCouponIds);
  }
  if (allSubIds.length > 0) {
    await adminClient.from('user_subscriptions').delete().in('id', allSubIds);
  }
  const allPlanIds = [planEnabled, planDisabled, planNoBenefit, planInvalidAmount, planFrequency].filter(Boolean);
  if (allPlanIds.length > 0) {
    await adminClient.from('tier_benefits').delete().in('plan_id', allPlanIds);
    await adminClient.from('subscription_plans').delete().in('id', allPlanIds);
  }
});

describe('issue_subscription_benefit_coupon — 정상 발급 (Happy)', () => {
  it('RED: DISCOUNT_COUPON 혜택이 켜진 구독은 결제 성공 시 쿠폰이 실제로 생성된다', async () => {
    const { data, error } = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subEnabled,
    });

    expect(error).toBeNull();
    expect(data?.issued).toBe(true);
    expect(typeof data?.coupon_id).toBe('string');
    const couponId = data?.coupon_id as string;
    createdCouponIds.push(couponId);

    // coupons.discount_value가 tier_benefits.benefit_params.coupon_amount(5000)와 일치하는가
    const { data: couponRow } = await adminClient!
      .from('coupons')
      .select('discount_value, type, discount_type, code, code_mode, is_subscription_only')
      .eq('id', couponId)
      .single();
    const coupon = couponRow as {
      discount_value: number;
      type: string;
      discount_type: string;
      code: string | null;
      code_mode: string;
      is_subscription_only: boolean;
    };
    expect(Number(coupon.discount_value)).toBe(5000);
    expect(coupon.type).toBe('subscription');
    expect(coupon.discount_type).toBe('fixed');
    expect(coupon.code_mode).toBe('manual');
    expect(coupon.code).toBeTruthy(); // manual 모드는 code NOT NULL 제약 — 발급 즉시 채번돼야 함
    expect(coupon.is_subscription_only).toBe(false);

    // user_coupons에 그 구독의 소유자에게 실제로 지급됐는가
    const { data: userCouponRow } = await adminClient!
      .from('user_coupons')
      .select('user_id, coupon_id')
      .eq('coupon_id', couponId)
      .single();
    expect((userCouponRow as { user_id: string } | null)?.user_id).toBe(testUserIds[0]);

    // subscription_benefit_usage에 이번 달 사용기록이 남았는가
    const { data: usageRows } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subEnabled)
      .eq('benefit_type', 'DISCOUNT_COUPON');
    expect((usageRows ?? []).length).toBe(1);
  });
});

describe('issue_subscription_benefit_coupon — 차단 케이스 (Edge/Error)', () => {
  it('RED: 혜택이 꺼져있으면(is_enabled=false) 발급되지 않는다', async () => {
    const { data, error } = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subDisabled,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED');
  });

  it('RED: tier_benefits 행 자체가 없는 플랜은 발급되지 않는다', async () => {
    const { data, error } = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subNoBenefit,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED');
  });

  it('RED: coupon_amount가 0이면 INVALID_COUPON_AMOUNT로 차단된다', async () => {
    const { data, error } = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subInvalidAmount,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('INVALID_COUPON_AMOUNT');
  });

  it('RED: 존재하지 않는 구독 id는 SUBSCRIPTION_NOT_FOUND를 반환한다(예외를 던지지 않음)', async () => {
    const { data, error } = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: -999999,
    });
    expect(error).toBeNull();
    expect(data?.issued).toBe(false);
    expect(data?.reason).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('RED: 월 발행횟수(coupon_frequency=1) 한도를 채운 뒤 재호출하면 발급되지 않는다', async () => {
    const first = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subFrequency,
    });
    expect(first.error).toBeNull();
    expect(first.data?.issued).toBe(true);
    const firstCouponId = first.data?.coupon_id as string;
    createdCouponIds.push(firstCouponId);

    // 같은 달에 재호출 — coupon_frequency=1 한도를 이미 채웠으므로 두 번째는 차단돼야 한다
    const second = await adminRpcCall('issue_subscription_benefit_coupon', {
      p_user_subscription_id: subFrequency,
    });
    expect(second.error).toBeNull();
    expect(second.data?.issued).toBe(false);
    expect(second.data?.reason).toBe('MONTHLY_LIMIT_REACHED');

    // 실제로 쿠폰이 1장만 발급됐는지(2장이 생기면 한도 로직이 무력화된 것)
    const { data: usageRows } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subFrequency)
      .eq('benefit_type', 'DISCOUNT_COUPON');
    expect((usageRows ?? []).length).toBe(1);
  });
});
