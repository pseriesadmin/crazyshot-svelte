-- Migration #259: 정기 재청구 크론 — 이중청구 방지 클레임 메커니즘
--
-- 배경: /cms/customers/membership 구독정보·구독결제고객 정보 반영 개발보완 플랜 Part C.
--       chargeSubscription()(Toss 빌링 청구)은 이미 /subscribe/success(최초 가입)에서 정상
--       동작하지만, 매달 재청구하는 크론이 전혀 없어 next_billing_date가 기록만 되고 아무도
--       읽지 않는 상태였다. 이번 마이그레이션은 재청구 대상을 원자적으로 "선점"하는 RPC를
--       추가해, 크론이 중복 실행되거나 겹쳐 돌아도 같은 구독을 두 번 청구하지 않도록 한다.
--
-- 절대 제약:
--   ① ADD-ONLY — 기존 마이그레이션 파일(223/224) 수정 없음, 컬럼 삭제 없음
--   ② record_subscription_charge_result는 CREATE OR REPLACE(시그니처 무변경)로 billing_claimed_at
--      해제만 추가 — 기존 청구 성공/실패 로직(next_billing_date 갱신, fail_count, 3회 만료)은 무변경
--   ③ chargeSubscription.ts(Node 쪽 Toss 빌링 호출 로직)는 이 마이그레이션과 무관 — 수정 안 함
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS billing_claimed_at TIMESTAMPTZ;

-- 크론이 매일 `status='active' AND next_billing_date<=CURRENT_DATE`를 스캔하는 쿼리 패턴을
-- 그대로 지원하는 복합 인덱스. billing_claimed_at은 WHERE절 보조 조건(IS NULL/stale)이라
-- 별도 컬럼으로 추가하지 않음 — 두 컬럼 인덱스로도 대상 구독 수가 적어(월 1회 청구 대상만) 충분.
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status_next_billing
  ON user_subscriptions (status, next_billing_date);

-- ── claim_subscriptions_due_for_billing ──────────────────────────────────
-- 원자적 선점: status='active' AND next_billing_date<=오늘 인 구독을 최대 p_limit건 잠금(FOR
-- UPDATE SKIP LOCKED) 후 billing_claimed_at=now()로 마킹해 청구에 필요한 정보와 함께 반환.
-- p_stale_minutes 이전에 선점됐지만 아직 해제 안 된(=크론이 죽어서 기록 실패한) 행은 재선점
-- 허용해 좀비 잠금을 방지한다.
CREATE OR REPLACE FUNCTION public.claim_subscriptions_due_for_billing(
  p_limit INTEGER DEFAULT 20,
  p_stale_minutes INTEGER DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  user_id UUID,
  plan_id BIGINT,
  billing_key TEXT,
  monthly_price INTEGER,
  plan_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE user_subscriptions us
  SET billing_claimed_at = now()
  WHERE us.id IN (
    SELECT s.id FROM user_subscriptions s
    WHERE s.status = 'active'
      AND s.next_billing_date <= CURRENT_DATE
      AND (s.billing_claimed_at IS NULL OR s.billing_claimed_at < now() - (p_stale_minutes || ' minutes')::interval)
    ORDER BY s.next_billing_date ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING
    us.id, us.user_id, us.plan_id, us.billing_key,
    (SELECT sp.monthly_price FROM subscription_plans sp WHERE sp.id = us.plan_id),
    (SELECT sp.name FROM subscription_plans sp WHERE sp.id = us.plan_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) IS
  '정기 재청구 크론 전용 — 원자적으로 청구 대상을 선점(billing_claimed_at=now())하고 청구에
   필요한 정보(billing_key, monthly_price, plan_name)를 반환한다. 동시/중복 실행 시 같은 구독이
   두 번 선점되지 않도록 FOR UPDATE SKIP LOCKED 사용. p_stale_minutes 경과 후에는 재선점 허용
   (크론이 죽어서 해제 안 된 좀비 잠금 방지).';

-- ── record_subscription_charge_result 확장 — 청구 결과 확정 시 billing_claimed_at 해제 ──
-- 시그니처·기존 로직(next_billing_date 갱신, fail_count 누적, 3회 연속 실패 시 expired)은
-- 마이그레이션 224와 동일 — billing_claimed_at = NULL 해제만 추가.
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
        billing_claimed_at = NULL,
        updated_at = now()
    WHERE id = p_user_subscription_id;
  ELSE
    v_fail_count := COALESCE(v_fail_count, 0) + 1;
    v_next_status := CASE WHEN v_fail_count >= 3 THEN 'expired' ELSE 'active' END;
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

-- ============================================================
-- ROLLBACK
-- ============================================================
-- -- record_subscription_charge_result를 Migration 224 원본으로 되돌림(billing_claimed_at 해제 제거):
-- CREATE OR REPLACE FUNCTION public.record_subscription_charge_result(
--   p_user_subscription_id BIGINT, p_status TEXT, p_amount INTEGER, p_toss_response JSONB DEFAULT NULL
-- ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- -- (Migration 224 본문 그대로 복원 — billing_claimed_at = NULL 라인 2곳 제거)
-- $$;
--
-- DROP FUNCTION IF EXISTS public.claim_subscriptions_due_for_billing(INTEGER, INTEGER);
-- DROP INDEX IF EXISTS idx_user_subscriptions_status_next_billing;
-- ALTER TABLE user_subscriptions DROP COLUMN IF EXISTS billing_claimed_at;
-- ============================================================
