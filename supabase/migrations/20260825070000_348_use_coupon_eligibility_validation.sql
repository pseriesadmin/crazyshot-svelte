-- Migration 348: use_coupon RPC — 7개 자격조건 검증 강화
-- TASK.md "쿠폰 자격조건 7개 검증" GATE B 승인 (2026-08-25, Stephen 기본안 전부 채택)
--
-- Q1(전체AND): min_rental_days는 주문 내 모든 예약의 최소일수 기준,
--             is_walk_in_only는 모든 예약이 pickup_method='visit'이어야 통과
-- Q2(첫대여 신규판정): rental_reservations 직접 조회, rental_count 컬럼 사용 금지
-- Q3(두 금액컬럼 동일취급): min_purchase_amount/min_rental_amount 둘 다 orders.total_amount와 비교
-- Q4(Stage 실측): 전체 6개 쿠폰 전부 기본값(0/0/0/false/false/false/false) — 회귀 없음 확인
-- Q5(파라미터 미추가): use_coupon(UUID, UUID, BIGINT) 동일 시그니처 유지, p_order_id 내부 재조회
--
-- 신규 에러코드 7개:
--   ORDER_CONTEXT_REQUIRED : p_order_id=NULL인데 주문의존 조건이 설정된 경우(EC-4 안전측 실패)
--   MIN_AMOUNT_NOT_MET     : min_purchase_amount 또는 min_rental_amount 미충족
--   MIN_DAYS_NOT_MET       : min_rental_days 미충족 (Q1 전체AND)
--   WALK_IN_ONLY           : is_walk_in_only이나 모든 예약이 방문 아님 (Q1 전체AND)
--   FIRST_RENTAL_ONLY      : 이미 대여 이력 있는 회원 (Q2 기준)
--   STUDENT_ONLY           : user_profiles.is_student != true
--   SUBSCRIPTION_ONLY      : 활성 구독(subscriptions.status='active', deleted_at IS NULL) 없음
--
-- 기존 에러코드 4개(무변경):
--   COUPON_NOT_FOUND / ALREADY_USED / COUPON_INACTIVE / COUPON_EXPIRED

CREATE OR REPLACE FUNCTION public.use_coupon(
  p_user_id        UUID,
  p_user_coupon_id UUID,
  p_order_id       BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uc           RECORD;   -- user_coupon 행 + coupons 7개 자격조건 컬럼 포함
  v_order_amount NUMERIC;  -- orders.total_amount (Q3 기준)
  v_min_days     INT;      -- 주문 내 최단 대여일수 (Q1 전체AND)
  v_all_visit    BOOLEAN;  -- 주문 내 모든 예약이 pickup_method='visit' (Q1 전체AND)
  v_redeemed_code TEXT;
BEGIN
  -- ① 기본 검증: user_coupon 행 취득 + 행 레벨 잠금(FOR UPDATE OF uc)
  --    7개 자격조건 컬럼도 이 시점에 함께 조회 — 검증은 기존 4개 에러코드 이후에 수행
  SELECT
    uc.id,
    uc.coupon_id,
    uc.used_at,
    c.is_active,
    c.deleted_at,
    c.valid_from,
    c.valid_until,
    c.min_purchase_amount,
    c.min_rental_amount,
    c.min_rental_days,
    c.is_first_rental_only,
    c.is_student_only,
    c.is_subscription_only,
    c.is_walk_in_only
  INTO v_uc
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id
    AND uc.user_id = p_user_id
  FOR UPDATE OF uc;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  IF v_uc.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;

  IF NOT v_uc.is_active OR v_uc.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_INACTIVE');
  END IF;

  IF v_uc.valid_until IS NOT NULL AND v_uc.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
  END IF;

  -- ② 주문의존 자격조건 검증
  --    EC-4 안전측 실패: p_order_id=NULL인데 주문의존 조건이 하나라도 있으면 즉시 거부
  IF COALESCE(v_uc.min_purchase_amount, 0) > 0
     OR COALESCE(v_uc.min_rental_amount, 0) > 0
     OR COALESCE(v_uc.min_rental_days, 0) > 0
     OR v_uc.is_walk_in_only
  THEN
    IF p_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ORDER_CONTEXT_REQUIRED');
    END IF;

    -- 주문 총액 조회 (Q3: min_purchase_amount/min_rental_amount 둘 다 total_amount 기준)
    SELECT o.total_amount INTO v_order_amount
    FROM orders o
    WHERE o.id = p_order_id;

    -- min_purchase_amount 체크 (Q3)
    IF COALESCE(v_uc.min_purchase_amount, 0) > 0
       AND (v_order_amount IS NULL OR v_order_amount < v_uc.min_purchase_amount)
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MIN_AMOUNT_NOT_MET');
    END IF;

    -- min_rental_amount 체크 (Q3: 동일 total_amount 기준)
    IF COALESCE(v_uc.min_rental_amount, 0) > 0
       AND (v_order_amount IS NULL OR v_order_amount < v_uc.min_rental_amount)
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MIN_AMOUNT_NOT_MET');
    END IF;

    -- min_rental_days / is_walk_in_only: order_items → rental_reservations 집계
    -- Q1 전체AND: 주문 내 모든 예약이 기준을 충족해야 통과
    IF COALESCE(v_uc.min_rental_days, 0) > 0 OR v_uc.is_walk_in_only THEN
      SELECT
        MIN(COALESCE(
          rr.rental_days,
          (rr.end_date::date - rr.start_date::date + 1)
        )),
        BOOL_AND(rr.pickup_method = 'visit')
      INTO v_min_days, v_all_visit
      FROM order_items oi
      JOIN rental_reservations rr ON rr.id = oi.reservation_id
      WHERE oi.order_id = p_order_id;

      IF COALESCE(v_uc.min_rental_days, 0) > 0
         AND (v_min_days IS NULL OR v_min_days < v_uc.min_rental_days)
      THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MIN_DAYS_NOT_MET');
      END IF;

      IF v_uc.is_walk_in_only
         AND (v_all_visit IS NULL OR NOT v_all_visit)
      THEN
        RETURN jsonb_build_object('ok', false, 'error', 'WALK_IN_ONLY');
      END IF;
    END IF;
  END IF;

  -- ③ 사용자의존 자격조건 검증

  -- 첫 대여 전용 (Q2: rental_reservations 직접 조회, rental_count 컬럼 사용 금지)
  -- hold/draft/cancelled/expired 상태는 "실제 대여 진행"으로 보지 않음
  IF v_uc.is_first_rental_only THEN
    IF EXISTS (
      SELECT 1
      FROM rental_reservations
      WHERE user_id = p_user_id
        AND status NOT IN ('hold', 'draft', 'cancelled', 'expired')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FIRST_RENTAL_ONLY');
    END IF;
  END IF;

  -- 학생 전용
  IF v_uc.is_student_only THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = p_user_id AND is_student = true
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STUDENT_ONLY');
    END IF;
  END IF;

  -- 구독자 전용 (실제 테이블명은 subscriptions가 아니라 user_subscriptions —
  -- deleted_at 컬럼 없음, status CHECK 제약이 'active'/'cancelled'/'expired'만 허용)
  IF v_uc.is_subscription_only THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_subscriptions
      WHERE user_id = p_user_id
        AND status = 'active'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SUBSCRIPTION_ONLY');
    END IF;
  END IF;

  -- ④ 모든 검증 통과 → 실제 소진 처리
  UPDATE user_coupons
  SET used_at    = now(),
      used_count = used_count + 1,
      order_id   = p_order_id
  WHERE id = p_user_coupon_id;

  UPDATE coupons
  SET usage_count = usage_count + 1
  WHERE id = v_uc.coupon_id;

  SELECT public.generate_user_coupon_redeemed_code(p_user_coupon_id)
  INTO v_redeemed_code;

  RETURN jsonb_build_object('ok', true, 'redeemed_code', v_redeemed_code);
END;
$$;

-- 기존 GRANT와 동일 (파라미터 시그니처 불변 — PGRST203 방지, Q5 기본안)
GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) TO authenticated;
