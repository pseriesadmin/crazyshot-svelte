import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient } from '@supabase/supabase-js';

// subscription_plans INSERT는 is_cms_user()만 허용(RLS) — 테스트 픽스처 준비는 서비스 롤 클라이언트로
const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

/**
 * S1-M4 Subscriptions — 고객 빌링키 가입 흐름 + 정기청구 (TDD)
 * 토스페이먼츠 빌링(정기결제) 연동 — RED → GREEN → REFACTOR
 *
 * 범위:
 *   - create_user_subscription RPC (빌링키 발급 후 구독 생성, 중복구독 방지)
 *   - record_subscription_charge_result RPC (청구 성공/실패 기록, 다음 청구일 갱신, 3회 연속
 *     실패 시 만료 처리) — /subscribe/success(최초 청구)와 정기청구 크론이 공유
 *
 * 승인된 정책 (플랜 users-stevenmac-downloads-crazyshot-bac-effervescent-sun.md §5):
 *   ① 한 고객은 동시에 활성(active) 구독을 1개만 보유 가능
 *   ② 청구 실패 3회 연속 → 구독 상태 'expired' 자동 전환
 *   ③ 청구 성공 시 next_billing_date를 1개월 뒤로 갱신 + fail_count 리셋
 */

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────
type RpcResult = { data: Record<string, unknown> | null; error: { code: string; message: string } | null };
// 이 파일이 다루는 RPC 전부(create_user_subscription/record_subscription_charge_result/
// generate_subscription_product_code/generate_subscription_inventory_product_code)가
// Migration 260·262로 service_role 전용이 되어 anon 클라이언트로는 호출 불가 —
// 실제 앱 코드(chargeSubscription.ts 등)와 동일하게 adminClient(service role)로만 호출.
const adminRpcCall = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

// user_subscriptions.user_id는 user_profiles(id) FK 제약이 있어 임의 UUID로는 INSERT 불가 —
// 실행 시점에 스테이지 DB의 기존 user_profiles 7건을 조회해 재사용(하드코딩 방지).
// afterAll에서 testPlanId/testPlanIdNoSeries 기준으로 생성된 user_subscriptions/
// subscription_payment_logs만 정리하므로 해당 계정들의 다른 데이터에는 영향 없음.
let testPlanId: number;
let testPlanIdNoSeries: number;
let testPlanIdCombo: number;
let testUserIds: string[] = [];
let testCodePrefix = 'SUB';

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가');

  // subscription_plans INSERT는 is_cms_user() 전용(RLS, 마이그레이션 223) — 서비스 롤로 픽스처 생성
  const { data: planData, error: planError } = await adminClient
    .from('subscription_plans')
    .insert({ name: `__TEST_PLAN_${Date.now()}`, monthly_price: 9900, status: 'active' })
    .select('id')
    .single();
  if (planError || !planData) throw new Error(`테스트 플랜 픽스처 생성 실패: ${planError?.message}`);
  testPlanId = (planData as { id: number }).id;

  // code_series가 없는(§8-F "품번 체계 미설정" 상황 재현) 2번째 플랜 — NO_CODE_SERIES 경로 테스트용
  const { data: planData2, error: planError2 } = await adminClient
    .from('subscription_plans')
    .insert({ name: `__TEST_PLAN_NOSERIES_${Date.now()}`, monthly_price: 9900, status: 'active' })
    .select('id')
    .single();
  if (planError2 || !planData2) throw new Error(`테스트 플랜(No Series) 픽스처 생성 실패: ${planError2?.message}`);
  testPlanIdNoSeries = (planData2 as { id: number }).id;

  // 코드조합(콤보) prefix 저장 테스트 전용 — testPlanIdNoSeries와 분리(그 플랜은 "code_series가
  // 끝까지 없는" 시나리오 전용이라 여기서 code_series를 설정하면 그 테스트와 오염됨)
  const { data: planData3, error: planError3 } = await adminClient
    .from('subscription_plans')
    .insert({ name: `__TEST_PLAN_COMBO_${Date.now()}`, monthly_price: 9900, status: 'active' })
    .select('id')
    .single();
  if (planError3 || !planData3) throw new Error(`테스트 플랜(Combo) 픽스처 생성 실패: ${planError3?.message}`);
  testPlanIdCombo = (planData3 as { id: number }).id;

  const { data: userRows, error: userError } = await adminClient
    .from('user_profiles')
    .select('id')
    .limit(7);
  if (userError || !userRows || userRows.length < 7) {
    throw new Error('테스트용 user_profiles 픽스처 부족(최소 7건 필요) — 스테이지 DB 상태 확인 필요');
  }
  testUserIds = (userRows as { id: string }[]).map((r) => r.id);

  // 부모(플랜) code_series 사전 설정 — §2-1 부모/자식 원칙: 부모는 구조만, 자식이 실제 품번을 받음
  const { data: codeSeriesResult } = await adminRpcCall('generate_subscription_product_code', {
    p_plan_id: testPlanId,
    p_category: 'camera',
    p_category_code_override: null,
  });
  testCodePrefix =
    ((codeSeriesResult?.code_series as { prefix?: string } | undefined)?.prefix as string | undefined) ?? 'CAM';
});

afterAll(async () => {
  if (adminClient && testPlanId) {
    await adminClient.from('subscription_payment_logs').delete().eq('plan_id', testPlanId);
    await adminClient.from('user_subscriptions').delete().eq('plan_id', testPlanId);
    await adminClient.from('subscription_plans').delete().eq('id', testPlanId);
  }
  if (adminClient && testPlanIdNoSeries) {
    await adminClient.from('subscription_payment_logs').delete().eq('plan_id', testPlanIdNoSeries);
    await adminClient.from('user_subscriptions').delete().eq('plan_id', testPlanIdNoSeries);
    await adminClient.from('subscription_plans').delete().eq('id', testPlanIdNoSeries);
  }
  if (adminClient && testPlanIdCombo) {
    await adminClient.from('subscription_payment_logs').delete().eq('plan_id', testPlanIdCombo);
    await adminClient.from('user_subscriptions').delete().eq('plan_id', testPlanIdCombo);
    await adminClient.from('subscription_plans').delete().eq('id', testPlanIdCombo);
  }
});

// ── create_user_subscription ────────────────────────────────────────────────
describe('create_user_subscription — 빌링키 가입', () => {
  it('RED: 정상 가입 시 subscription_id 반환 + status=active', async () => {
    const { data, error } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[0],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}`,
      p_billing_cycle_day: 15,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.subscription_id).toBeTruthy();
  });

  it('RED: 이미 활성 구독이 있는 유저 → ALREADY_SUBSCRIBED 에러', async () => {
    // 첫 번째 가입
    await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[1],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}_a`,
      p_billing_cycle_day: 1,
    });

    // 동일 유저 두 번째 가입 시도
    const { data } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[1],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}_b`,
      p_billing_cycle_day: 1,
    });

    expect(data?.success).toBe(false);
    expect(data?.error).toBe('ALREADY_SUBSCRIBED');
  });

  it('RED: 존재하지 않는 plan_id → PLAN_NOT_FOUND 에러', async () => {
    const { data } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[2],
      p_plan_id: -999,
      p_billing_key: `billing_TEST_${Date.now()}`,
      p_billing_cycle_day: 1,
    });

    expect(data?.success).toBe(false);
    expect(data?.error).toBe('PLAN_NOT_FOUND');
  });
});

// ── record_subscription_charge_result ───────────────────────────────────────
describe('record_subscription_charge_result — 청구 결과 기록', () => {
  it('RED: 청구 성공 기록 → next_billing_date 1개월 뒤로 갱신 + fail_count 0', async () => {
    const { data: subResult } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[2],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}`,
      p_billing_cycle_day: 1,
    });
    const subscriptionId = subResult?.subscription_id;

    // Migration 259: 크론이 claim_subscriptions_due_for_billing로 선점(billing_claimed_at=now())한
    // 상태를 재현 — 청구 결과 확정 후 이 값이 반드시 해제(NULL)돼야 다음 달 재선점이 가능하다.
    await adminClient!
      .from('user_subscriptions')
      .update({ billing_claimed_at: new Date().toISOString() })
      .eq('id', subscriptionId as number);

    const { data, error } = await adminRpcCall('record_subscription_charge_result', {
      p_user_subscription_id: subscriptionId,
      p_status: 'succeeded',
      p_amount: 9900,
      p_toss_response: { mock: true },
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.next_status).toBe('active');

    const { data: row } = await adminClient!
      .from('user_subscriptions')
      .select('billing_claimed_at')
      .eq('id', subscriptionId as number)
      .single();
    expect((row as { billing_claimed_at: string | null } | null)?.billing_claimed_at).toBeNull();
  });

  it('RED: 청구 실패 3회 연속 → 구독 status가 expired로 전환', async () => {
    const { data: subResult } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[3],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}`,
      p_billing_cycle_day: 1,
    });
    const subscriptionId = subResult?.subscription_id;

    let lastResult: Record<string, unknown> | null = null;
    for (let i = 0; i < 3; i++) {
      // Migration 259: 매 청구 시도 전 크론의 선점 상태를 재현 — 실패 경로에서도 결과 확정 후
      // billing_claimed_at이 해제돼야 한다(성공 경로와 동일 보장).
      await adminClient!
        .from('user_subscriptions')
        .update({ billing_claimed_at: new Date().toISOString() })
        .eq('id', subscriptionId as number);

      const { data } = await adminRpcCall('record_subscription_charge_result', {
        p_user_subscription_id: subscriptionId,
        p_status: 'failed',
        p_amount: 9900,
        p_toss_response: { mock: true, attempt: i + 1 },
      });
      lastResult = data;
    }

    expect(lastResult?.next_status).toBe('expired');

    const { data: row } = await adminClient!
      .from('user_subscriptions')
      .select('billing_claimed_at')
      .eq('id', subscriptionId as number)
      .single();
    expect((row as { billing_claimed_at: string | null } | null)?.billing_claimed_at).toBeNull();
  });
});

// ── generate_subscription_product_code (부모/플랜) — 실제 품번 미발급, code_series만 저장 ──
describe('generate_subscription_product_code — 부모(플랜)는 code_series만 저장, 실제 품번은 미발급', () => {
  it('RED: code_series 설정 후에도 subscription_plans.product_code는 NULL로 유지된다', async () => {
    const { data: plan } = await adminClient!
      .from('subscription_plans')
      .select('product_code, code_series')
      .eq('id', testPlanId)
      .single();

    expect((plan as { product_code: string | null } | null)?.product_code).toBeNull();
    expect((plan as { code_series: unknown } | null)?.code_series).toBeTruthy();
  });

  it('RED: 이미 code_series가 설정된 플랜에 재호출 시 ALREADY_SET, 구조가 바뀌지 않는다', async () => {
    const { data } = await adminRpcCall('generate_subscription_product_code', {
      p_plan_id: testPlanId,
      p_category: 'lens',
      p_category_code_override: null,
    });

    expect(data?.success).toBe(false);
    expect(data?.error).toBe('ALREADY_SET');

    const { data: plan } = await adminClient!
      .from('subscription_plans')
      .select('code_series')
      .eq('id', testPlanId)
      .single();
    const prefix = ((plan as { code_series: { prefix?: string } } | null)?.code_series)?.prefix;
    expect(prefix).toBe(testCodePrefix);
  });

  it('RED: 코드조합(콤보) 선택 시 합산 분류코드가 그대로 prefix로 저장된다', async () => {
    const { data } = await adminRpcCall('generate_subscription_product_code', {
      p_plan_id: testPlanIdCombo,
      p_category: 'camera',
      p_category_code_override: 'CMRCOM',
    });

    expect(data?.success).toBe(true);
    expect((data?.code_series as { prefix?: string } | undefined)?.prefix).toBe('CMRCOM');
  });
});

// ── create_user_subscription → generate_subscription_inventory_product_code (자식/구독자) ──
describe('create_user_subscription — 구독 생성 시 자식(구독자) 실제 품번 자동 발급', () => {
  let firstIssuedCode: string | null = null;

  it('RED: 구독 생성 응답에 SUB-{prefix}-#### 형식의 자식 품번이 포함된다', async () => {
    const { data } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[4],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}_child1`,
      p_billing_cycle_day: 1,
    });

    expect(data?.success).toBe(true);
    expect(typeof data?.product_code).toBe('string');
    expect(data?.product_code as string).toMatch(new RegExp(`^SUB-${testCodePrefix}-\\d{4}$`));
    firstIssuedCode = data?.product_code as string;
  });

  it('RED: 같은 플랜의 서로 다른 구독자는 서로 다른(순번이 다른) 품번을 받는다', async () => {
    const { data } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[5],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}_child2`,
      p_billing_cycle_day: 1,
    });

    expect(data?.success).toBe(true);
    expect(data?.product_code).toBeTruthy();
    expect(data?.product_code).not.toBe(firstIssuedCode);
  });

  it('RED: 이미 품번이 발급된 구독에 자식 채번 RPC를 재호출하면 ALREADY_ISSUED, 기존 품번 유지', async () => {
    const { data: subResult } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[6],
      p_plan_id: testPlanId,
      p_billing_key: `billing_TEST_${Date.now()}_child3`,
      p_billing_cycle_day: 1,
    });
    const subscriptionId = subResult?.subscription_id;
    const issuedCode = subResult?.product_code;

    const { data: retry } = await adminRpcCall('generate_subscription_inventory_product_code', {
      p_user_subscription_id: subscriptionId,
      p_plan_id: testPlanId,
    });

    expect(retry?.success).toBe(false);
    expect(retry?.error).toBe('ALREADY_ISSUED');
    expect(retry?.product_code).toBe(issuedCode);
  });

  it('RED: 부모 플랜에 code_series가 없으면 구독 생성은 성공하되 품번은 미발급(NO_CODE_SERIES 경고)', async () => {
    const { data } = await adminRpcCall('create_user_subscription', {
      p_user_id: testUserIds[3],
      p_plan_id: testPlanIdNoSeries,
      p_billing_key: `billing_TEST_${Date.now()}_noseries`,
      p_billing_cycle_day: 1,
    });

    // testUserIds[3]는 앞선 테스트에서 이미 만료(expired) 상태라 재구독 가능
    expect(data?.success).toBe(true);
    expect(data?.subscription_id).toBeTruthy();
    expect(data?.product_code).toBeNull();
    expect(data?.code_warning).toBe('NO_CODE_SERIES');
  });
});
