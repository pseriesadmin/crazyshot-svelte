import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient } from '@supabase/supabase-js';

/**
 * S1-M4 Subscriptions — 정기 재청구 크론 이중청구 방지 (TDD)
 * claim_subscriptions_due_for_billing RPC — Migration 259
 *
 * ⚠️ 이 RPC는 REVOKE ALL ... GRANT service_role 전용이라 anon 키(subscriptionBilling.test.ts의
 * `supabase` 클라이언트)로는 호출 불가 — 반드시 adminClient(service role)로만 호출한다.
 *
 * 범위:
 *   - 활성 + next_billing_date<=오늘 + 미선점 구독만 정확히 선점되는가
 *   - 동시(연속) 2회 호출 시 이미 선점된 구독이 두 번째 호출에서 재선점되지 않는가
 *   - status!='active' 또는 next_billing_date가 미래인 구독은 선점 대상에서 제외되는가
 */

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

type ClaimRow = {
  id: number;
  user_id: string;
  plan_id: number;
  billing_key: string;
  monthly_price: number | null;
  plan_name: string | null;
};

const callClaimRpc = async (
  p_limit = 1000,
  p_stale_minutes = 10
): Promise<{ data: ClaimRow[] | null; error: { message: string } | null }> => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');
  return (
    adminClient.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => Promise<{ data: ClaimRow[] | null; error: { message: string } | null }>
  )('claim_subscriptions_due_for_billing', { p_limit, p_stale_minutes });
};

let testPlanId: number;
let testUserIds: string[] = [];
let dueSubId: number; // status=active, next_billing_date=어제 → 선점 대상
let futureSubId: number; // status=active, next_billing_date=내일 → 선점 제외
let expiredDueSubId: number; // status=expired, next_billing_date=어제 → 선점 제외

const yesterday = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};
const tomorrow = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');

  const { data: planData, error: planError } = await adminClient
    .from('subscription_plans')
    .insert({ name: `__TEST_CLAIM_PLAN_${Date.now()}`, monthly_price: 9900, status: 'active' })
    .select('id')
    .single();
  if (planError || !planData) throw new Error(`테스트 플랜 픽스처 생성 실패: ${planError?.message}`);
  testPlanId = (planData as { id: number }).id;

  // subscriptionBilling.test.ts가 동일 스테이지 DB의 user_profiles 앞쪽 7건을 병렬로 점유하므로
  // (vitest 기본 파일 병렬실행 — create_user_subscription의 "유저당 활성구독 1개" 제약과 충돌
  // 가능) 뒤쪽 행을 선점해 픽스처 충돌을 피한다.
  const { data: userRows, error: userError } = await adminClient
    .from('user_profiles')
    .select('id')
    .order('id', { ascending: false })
    .limit(3);
  if (userError || !userRows || userRows.length < 3) {
    throw new Error('테스트용 user_profiles 픽스처 부족(최소 3건 필요) — 스테이지 DB 상태 확인 필요');
  }
  testUserIds = (userRows as { id: string }[]).map((r) => r.id);

  // 픽스처 1: 활성 + 어제 청구예정(due) — 선점 대상
  const { data: sub1, error: sub1Error } = await adminClient
    .from('user_subscriptions')
    .insert({
      user_id: testUserIds[0],
      plan_id: testPlanId,
      status: 'active',
      billing_key: `billing_CLAIM_TEST_${Date.now()}_due`,
      billing_cycle_day: 1,
      next_billing_date: yesterday(),
      fail_count: 0,
    })
    .select('id')
    .single();
  if (sub1Error || !sub1) throw new Error(`due 구독 픽스처 생성 실패: ${sub1Error?.message}`);
  dueSubId = (sub1 as { id: number }).id;

  // 픽스처 2: 활성 + 내일 청구예정(future) — 선점 제외
  const { data: sub2, error: sub2Error } = await adminClient
    .from('user_subscriptions')
    .insert({
      user_id: testUserIds[1],
      plan_id: testPlanId,
      status: 'active',
      billing_key: `billing_CLAIM_TEST_${Date.now()}_future`,
      billing_cycle_day: 1,
      next_billing_date: tomorrow(),
      fail_count: 0,
    })
    .select('id')
    .single();
  if (sub2Error || !sub2) throw new Error(`future 구독 픽스처 생성 실패: ${sub2Error?.message}`);
  futureSubId = (sub2 as { id: number }).id;

  // 픽스처 3: expired + 어제 청구예정 — status 조건으로 선점 제외
  const { data: sub3, error: sub3Error } = await adminClient
    .from('user_subscriptions')
    .insert({
      user_id: testUserIds[2],
      plan_id: testPlanId,
      status: 'expired',
      billing_key: `billing_CLAIM_TEST_${Date.now()}_expired`,
      billing_cycle_day: 1,
      next_billing_date: yesterday(),
      fail_count: 3,
    })
    .select('id')
    .single();
  if (sub3Error || !sub3) throw new Error(`expired 구독 픽스처 생성 실패: ${sub3Error?.message}`);
  expiredDueSubId = (sub3 as { id: number }).id;
});

afterAll(async () => {
  if (!adminClient || !testPlanId) return;
  await adminClient.from('subscription_payment_logs').delete().eq('plan_id', testPlanId);
  await adminClient.from('user_subscriptions').delete().eq('plan_id', testPlanId);
  await adminClient.from('subscription_plans').delete().eq('id', testPlanId);
});

describe('claim_subscriptions_due_for_billing — 정기청구 원자적 선점', () => {
  it('RED: 활성+due+미선점 구독만 정확히 선점되어 반환된다(billing_key/monthly_price/plan_name 포함)', async () => {
    const { data, error } = await callClaimRpc();

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const claimed = (data ?? []).find((row) => row.id === dueSubId);
    expect(claimed).toBeTruthy();
    expect(claimed?.plan_id).toBe(testPlanId);
    expect(claimed?.monthly_price).toBe(9900);
    expect(typeof claimed?.billing_key).toBe('string');

    // 선점 직후 DB에도 billing_claimed_at이 실제로 기록됐는지 재확인
    const { data: row } = await adminClient!
      .from('user_subscriptions')
      .select('billing_claimed_at')
      .eq('id', dueSubId)
      .single();
    expect((row as { billing_claimed_at: string | null } | null)?.billing_claimed_at).toBeTruthy();
  });

  it('RED: 동시(연속) 2회 호출 시 이미 선점된 구독은 두 번째 호출 결과에 포함되지 않는다', async () => {
    // 1회차 — 위 테스트에서 이미 선점됐을 수 있으므로 상태와 무관하게 재확인 목적으로 1회 더 호출
    await callClaimRpc();

    // 2회차 — 직전 호출에서 이미 선점(billing_claimed_at=now())됐으므로 stale 기준(10분) 이내
    // 재호출은 같은 구독을 다시 선점하면 안 된다.
    const { data, error } = await callClaimRpc();

    expect(error).toBeNull();
    const reclaimed = (data ?? []).find((row) => row.id === dueSubId);
    expect(reclaimed).toBeUndefined();
  });

  it('RED: status!=active(expired) 또는 next_billing_date가 미래인 구독은 선점되지 않는다', async () => {
    const { data, error } = await callClaimRpc();

    expect(error).toBeNull();
    const claimedIds = (data ?? []).map((row) => row.id);
    expect(claimedIds).not.toContain(futureSubId);
    expect(claimedIds).not.toContain(expiredDueSubId);
  });
});

// ── stale 재선점 + record_subscription_charge_result 연동(billing_claimed_at 해제) ──
// 위 describe와 별개 픽스처 사용 — 선점 상태를 직접 조작해야 하므로 격리 필요.
describe('claim_subscriptions_due_for_billing — stale 재선점 및 청구결과 연동', () => {
  it('GREEN: stale 경과분(좀비 잠금)은 p_stale_minutes 경과 후 재선점을 허용한다', async () => {
    const { data: sub, error: subError } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: testUserIds[0],
        plan_id: testPlanId,
        status: 'active',
        billing_key: `billing_CLAIM_TEST_${Date.now()}_stale`,
        billing_cycle_day: 1,
        next_billing_date: yesterday(),
        // 20분 전에 선점된 것처럼 직접 세팅 — "크론이 죽어서 해제 안 된" 상태 재현
        billing_claimed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        fail_count: 0,
      })
      .select('id')
      .single();
    if (subError || !sub) throw new Error(`stale 구독 픽스처 생성 실패: ${subError?.message}`);
    const staleSubId = (sub as { id: number }).id;

    // p_stale_minutes=10 → 20분 전 잠금은 재선점 대상
    const { data, error } = await callClaimRpc(1000, 10);
    expect(error).toBeNull();
    const claimedIds = (data ?? []).map((row) => row.id);
    expect(claimedIds).toContain(staleSubId);
  });

  it('REFACTOR: 청구 성공 기록 후 billing_claimed_at이 해제되고 next_billing_date가 갱신된다', async () => {
    const { data: sub } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: testUserIds[1],
        plan_id: testPlanId,
        status: 'active',
        billing_key: `billing_CLAIM_TEST_${Date.now()}_success`,
        billing_cycle_day: 1,
        next_billing_date: yesterday(),
        fail_count: 0,
      })
      .select('id')
      .single();
    const subId = (sub as { id: number }).id;
    await callClaimRpc(); // 선점 → billing_claimed_at 채워짐

    const { data: chargeResult, error } = await (
      adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{
        data: { success: boolean; next_status?: string } | null;
        error: { message: string } | null;
      }>
    )('record_subscription_charge_result', {
      p_user_subscription_id: subId,
      p_status: 'succeeded',
      p_amount: 9900,
      p_toss_response: { mock: true },
    });
    expect(error).toBeNull();
    expect(chargeResult?.success).toBe(true);

    const { data: row } = await adminClient!
      .from('user_subscriptions')
      .select('billing_claimed_at, next_billing_date')
      .eq('id', subId)
      .single();
    const typedRow = row as { billing_claimed_at: string | null; next_billing_date: string };
    expect(typedRow.billing_claimed_at).toBeNull();
    expect(new Date(typedRow.next_billing_date).getTime()).toBeGreaterThan(Date.now());
  });

  it('REFACTOR: 청구 실패 기록 후에도 billing_claimed_at이 해제된다(다음 재시도 가능)', async () => {
    const { data: sub } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: testUserIds[2],
        plan_id: testPlanId,
        status: 'active',
        billing_key: `billing_CLAIM_TEST_${Date.now()}_fail`,
        billing_cycle_day: 1,
        next_billing_date: yesterday(),
        fail_count: 0,
      })
      .select('id')
      .single();
    const subId = (sub as { id: number }).id;
    await callClaimRpc();

    await (
      adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
    )('record_subscription_charge_result', {
      p_user_subscription_id: subId,
      p_status: 'failed',
      p_amount: 9900,
      p_toss_response: { mock: true },
    });

    const { data: row } = await adminClient!
      .from('user_subscriptions')
      .select('billing_claimed_at')
      .eq('id', subId)
      .single();
    expect((row as { billing_claimed_at: string | null } | null)?.billing_claimed_at).toBeNull();
  });
});
