-- Migration #224: 구독 빌링 RPC 2종 — create_user_subscription / record_subscription_charge_result
--
-- 배경: CMS '구독' 모듈 Stage 6(TDD) — 고객 빌링키 가입 흐름 + 정기청구 결과 기록.
--       플랜 users-stevenmac-downloads-crazyshot-bac-effervescent-sun.md §5 참고.
--       두 RPC 모두 SECURITY DEFINER — service-role 서버 라우트(가입 확인 콜백, 정기청구 크론)
--       에서만 호출, H-01(직접 DML 금지) 준수.
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

-- ── create_user_subscription ─────────────────────────────────────────────
-- 빌링키 발급 완료 후 구독 생성. 정책: 한 유저는 동시에 active 구독 1개만 보유 가능.
CREATE OR REPLACE FUNCTION public.create_user_subscription(
  p_user_id UUID,
  p_plan_id BIGINT,
  p_billing_key TEXT,
  p_billing_cycle_day SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan_id BIGINT;
  v_existing_id BIGINT;
  v_new_id BIGINT;
BEGIN
  SELECT id INTO v_plan_id
  FROM subscription_plans
  WHERE id = p_plan_id AND status = 'active' AND deleted_at IS NULL;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  SELECT id INTO v_existing_id
  FROM user_subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_SUBSCRIBED');
  END IF;

  INSERT INTO user_subscriptions (
    user_id, plan_id, status, started_at, billing_key, billing_cycle_day, next_billing_date, fail_count
  ) VALUES (
    p_user_id, p_plan_id, 'active', now(), p_billing_key, p_billing_cycle_day,
    (CURRENT_DATE + INTERVAL '1 month')::date, 0
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'subscription_id', v_new_id);
END;
$$;

-- ── record_subscription_charge_result ────────────────────────────────────
-- 정기청구(최초 청구 포함) 성공/실패 결과 기록. /subscribe/success(최초 청구)와 정기청구
-- Vercel Cron이 공유. 성공 시 next_billing_date 1개월 갱신 + fail_count 리셋,
-- 실패 시 fail_count 누적 → 3회 연속 실패 시 status='expired' 자동 전환.
CREATE OR REPLACE FUNCTION public.record_subscription_charge_result(
  p_user_subscription_id BIGINT,
  p_status TEXT,
  p_amount INTEGER,
  p_toss_response JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan_id BIGINT;
  v_fail_count SMALLINT;
  v_next_status TEXT;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT plan_id, fail_count INTO v_plan_id, v_fail_count
  FROM user_subscriptions
  WHERE id = p_user_subscription_id;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  INSERT INTO subscription_payment_logs (user_subscription_id, plan_id, amount, status, toss_response)
  VALUES (p_user_subscription_id, v_plan_id, p_amount, p_status, p_toss_response);

  IF p_status = 'succeeded' THEN
    v_next_status := 'active';
    UPDATE user_subscriptions
    SET fail_count = 0,
        next_billing_date = (COALESCE(next_billing_date, CURRENT_DATE) + INTERVAL '1 month')::date,
        updated_at = now()
    WHERE id = p_user_subscription_id;
  ELSE
    v_fail_count := COALESCE(v_fail_count, 0) + 1;
    v_next_status := CASE WHEN v_fail_count >= 3 THEN 'expired' ELSE 'active' END;
    UPDATE user_subscriptions
    SET fail_count = v_fail_count,
        status = v_next_status,
        updated_at = now()
    WHERE id = p_user_subscription_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'next_status', v_next_status);
END;
$$;
