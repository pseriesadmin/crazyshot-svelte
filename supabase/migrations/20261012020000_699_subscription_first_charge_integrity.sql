-- Migration #699: 구독 첫 결제 정합성 — 다음 청구일 이중 가산 방지 + 첫 결제 실패 시 즉시 만료
--
-- 배경(2026-10-12 구독 결제 최종 검증, Production 실데이터로 확인):
--   ① create_user_subscription이 가입 시 next_billing_date를 이미 "오늘 + 1개월"로 잡는데,
--      가입 직후 첫 결제 성공을 record_subscription_charge_result가 기록하면서 같은 날짜에 한 달을
--      또 더해 두 번째 청구일이 가입 후 두 달 뒤로 밀렸다(8/28 가입 → 10/28, 한 달치 청구 누락).
--   ② 첫 결제가 실패해도 구독이 active로 남아 한 달간 구독 혜택이 적용되고(장바구니가 active
--      구독을 구독자로 판정), 재가입도 ALREADY_SUBSCRIBED로 막혔다.
--
-- 변경(record_subscription_charge_result 1개 함수, 시그니처 무변경 — Migration 259 정의 기준):
--   ① 이 구독의 첫 성공 기록이고 next_billing_date가 이미 미래이면(= 가입 시 잡힌 날짜) 청구일을
--      더 밀지 않는다. 청구일이 이미 도래한 구독(next_billing_date <= 오늘)은 첫 성공이어도 평소처럼
--      한 달 전진한다 — 그렇지 않으면 매일 재청구되는 루프가 생길 수 있다.
--   ② 성공 이력이 한 번도 없는 구독의 결제 실패는 즉시 expired로 전환한다(혜택 중단 + 재가입 가능).
--      성공 이력이 있는 구독의 실패는 기존대로 3회 연속 실패 시에만 expired.
--
-- 무변경: 시그니처, 권한(service_role 전용 — Migration 260/263), billing_claimed_at 해제,
--         fail_count 누적, 결제 로그 INSERT, 반환 형식.
-- 롤백: 이 파일 하단 참고(Migration 259 본문으로 복원).
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh) 적용.

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
  v_next_billing DATE;
  v_next_status TEXT;
  v_has_prior_success BOOLEAN;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT plan_id, fail_count, next_billing_date INTO v_plan_id, v_fail_count, v_next_billing
  FROM user_subscriptions
  WHERE id = p_user_subscription_id;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  -- 이번 기록을 INSERT하기 "전에" 과거 성공 이력을 확인한다(이번 건이 첫 성공/첫 실패인지 판별).
  SELECT EXISTS (
    SELECT 1 FROM subscription_payment_logs
    WHERE user_subscription_id = p_user_subscription_id AND status = 'succeeded'
  ) INTO v_has_prior_success;

  INSERT INTO subscription_payment_logs (user_subscription_id, plan_id, amount, status, toss_response)
  VALUES (p_user_subscription_id, v_plan_id, p_amount, p_status, p_toss_response);

  IF p_status = 'succeeded' THEN
    v_next_status := 'active';
    UPDATE user_subscriptions
    SET fail_count = 0,
        next_billing_date = CASE
          -- 가입 직후 첫 결제: 가입 시 이미 "+1개월"로 잡힌 청구일을 그대로 유지(이중 가산 방지)
          WHEN NOT v_has_prior_success AND v_next_billing IS NOT NULL AND v_next_billing > CURRENT_DATE
            THEN v_next_billing
          ELSE (COALESCE(v_next_billing, CURRENT_DATE) + INTERVAL '1 month')::date
        END,
        billing_claimed_at = NULL,
        updated_at = now()
    WHERE id = p_user_subscription_id;
  ELSE
    v_fail_count := COALESCE(v_fail_count, 0) + 1;
    -- 성공 이력이 없는 구독(= 첫 결제 실패)은 즉시 만료, 그 외는 3회 연속 실패 시 만료
    v_next_status := CASE
      WHEN NOT v_has_prior_success THEN 'expired'
      WHEN v_fail_count >= 3 THEN 'expired'
      ELSE 'active'
    END;
    UPDATE user_subscriptions
    SET fail_count = v_fail_count,
        status = v_next_status,
        billing_claimed_at = NULL,
        updated_at = now()
    WHERE id = p_user_subscription_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'next_status', v_next_status);
END;
$$;

-- CREATE OR REPLACE는 기존 권한을 보존하지만, 서버 전용 함수의 권한은 명시적으로 재확인한다(security-auth §23).
REVOKE ALL ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 259의 record_subscription_charge_result 본문(billing_claimed_at 해제 포함)으로 되돌린다:
--   supabase/migrations/20260815000259_259_subscription_billing_claim.sql 의
--   "record_subscription_charge_result 확장" CREATE OR REPLACE 블록을 그대로 재실행.
-- ============================================================
