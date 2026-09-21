-- Migration 511: 쿠폰 미작동 설정 4건 실제 반영
--   1) coupons.max_discount_amount — percentage 할인의 상한 캡을 정산(sync_order_after_
--      composition_change)에 반영 (기존엔 캡 없이 무제한 적용되던 결함)
--   2) coupons.allow_with_points — false면 쿠폰 선택 시 포인트 병행 사용을 정산에서 배제
--      (allow_stacking과 동일한 "고객이 선택한 쿠폰 우선" 원칙 적용)
--   3) coupons.per_user_limit — use_coupon 소진 처리 시 이 사용자의 기존 사용 횟수를
--      재검증(기존엔 저장만 되고 어디서도 읽히지 않던 완전 죽은 필드)
--   4) coupons.applicable_categories — type='category'인 쿠폰만 주문 내 상품 카테고리와
--      실제로 대조(기존엔 저장만 되고 어디서도 대조되지 않던 완전 죽은 필드)
--
-- 롤백: 20260921000000_510_sync_order_coupon_discount_fix.sql(정산)과
--       그 이전 use_coupon 정의(Migration 348 계열)로 각각 되돌릴 것.

CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id uuid, p_user_coupon_id uuid, p_order_id bigint DEFAULT NULL::bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uc           RECORD;   -- user_coupon 행 + coupons 자격조건 컬럼 포함
  v_order_amount NUMERIC;  -- orders.total_amount (Q3 기준)
  v_min_days     INT;      -- 주문 내 최단 대여일수 (Q1 전체AND)
  v_all_visit    BOOLEAN;  -- 주문 내 모든 예약이 pickup_method='visit' (Q1 전체AND)
  v_redeemed_code TEXT;
  v_used_count_by_user INT;
BEGIN
  -- ① 기본 검증: user_coupon 행 취득 + 행 레벨 잠금(FOR UPDATE OF uc)
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
    c.is_walk_in_only,
    c.per_user_limit,
    c.type,
    c.applicable_categories
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
     OR (v_uc.type = 'category' AND v_uc.applicable_categories IS NOT NULL AND jsonb_array_length(v_uc.applicable_categories) > 0)
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

    -- applicable_categories 체크 (2026-09-21 추가) — type='category'인 쿠폰만 실제 게이팅
    IF v_uc.type = 'category' AND v_uc.applicable_categories IS NOT NULL AND jsonb_array_length(v_uc.applicable_categories) > 0 THEN
      IF NOT EXISTS (
        SELECT 1
        FROM order_items oi
        JOIN rental_reservations rr ON rr.id = oi.reservation_id
        JOIN products p ON p.id = rr.product_id
        WHERE oi.order_id = p_order_id
          AND p.category IN (SELECT jsonb_array_elements_text(v_uc.applicable_categories))
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_APPLICABLE');
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

  -- 1인당 사용 한도 (2026-09-21 추가) — 이 사용자가 이미 이 쿠폰(coupon_id)을 몇 번
  -- 사용했는지 확인. per_user_limit<=0은 무제한(0=무제한 관례).
  IF COALESCE(v_uc.per_user_limit, 0) > 0 THEN
    SELECT count(*) INTO v_used_count_by_user
    FROM user_coupons
    WHERE user_id = p_user_id
      AND coupon_id = v_uc.coupon_id
      AND used_at IS NOT NULL;

    IF v_used_count_by_user >= v_uc.per_user_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PER_USER_LIMIT_EXCEEDED');
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
$function$;

-- ── sync_order_after_composition_change: max_discount_amount 캡 + allow_with_points 게이트 ──
CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change(p_order_id bigint)
RETURNS TABLE(success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id               UUID;
  v_grade                 TEXT;
  v_rate                  NUMERIC := 0;
  v_total                 NUMERIC := 0;
  v_discount              NUMERIC := 0;
  v_coupon_discount       NUMERIC := 0;
  v_coupon_discount_type  TEXT;
  v_coupon_discount_value NUMERIC;
  v_coupon_allow_stacking BOOLEAN := false;
  v_coupon_max_discount   NUMERIC;
  v_coupon_allow_with_points BOOLEAN := true;
  v_holiday_extra_fee     NUMERIC := 0;
  v_final                 NUMERIC := 0;
  v_coupon_id             UUID;
  v_points                INTEGER;
  v_delivery_fee          INTEGER;
  v_canonical_code        TEXT;
BEGIN
  SELECT user_id, selected_coupon_id, selected_points, delivery_fee
  INTO   v_user_id, v_coupon_id, v_points, v_delivery_fee
  FROM   orders
  WHERE  id = p_order_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, '주문을 찾을 수 없습니다.';
    RETURN;
  END IF;

  v_points       := GREATEST(0, COALESCE(v_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(v_delivery_fee, 0));

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  SELECT rr.reservation_code INTO v_canonical_code
  FROM   order_items oi
  JOIN   rental_reservations rr ON rr.id = oi.reservation_id
  WHERE  oi.order_id = p_order_id
  ORDER  BY rr.id ASC
  LIMIT  1;

  IF v_canonical_code IS NOT NULL THEN
    UPDATE rental_reservations rr
    SET    reservation_code = v_canonical_code
    WHERE  rr.id IN (
      SELECT oi.reservation_id FROM order_items oi WHERE oi.order_id = p_order_id
    )
      AND  rr.reservation_code IS DISTINCT FROM v_canonical_code;
  END IF;

  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM   order_items oi
  WHERE  oi.order_id = p_order_id;

  SELECT COALESCE(SUM(line.holiday_extra_fee), 0)
  INTO   v_holiday_extra_fee
  FROM   order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS line
  WHERE  oi.order_id = p_order_id;

  v_coupon_discount := 0;
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.discount_type, c.discount_value, c.allow_stacking, c.max_discount_amount, c.allow_with_points
      INTO v_coupon_discount_type, v_coupon_discount_value, v_coupon_allow_stacking, v_coupon_max_discount, v_coupon_allow_with_points
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_coupon_id;

    IF v_coupon_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_coupon_discount_value, 0);
    ELSIF v_coupon_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_coupon_discount_value, 0) / 100.0);
      IF v_coupon_max_discount IS NOT NULL AND v_coupon_max_discount > 0 THEN
        v_coupon_discount := LEAST(v_coupon_discount, v_coupon_max_discount);
      END IF;
    ELSIF v_coupon_discount_type = 'free_shipping' THEN
      v_coupon_discount := LEAST(COALESCE(v_coupon_discount_value, 0), v_delivery_fee);
    END IF;

    -- allow_with_points=false면 쿠폰이 우선하고 포인트 사용은 정산에서 배제
    -- (allow_stacking과 동일한 "고객이 선택한 쿠폰 우선" 원칙, 2026-09-21 추가)
    IF NOT COALESCE(v_coupon_allow_with_points, true) THEN
      v_points := 0;
    END IF;
  END IF;

  IF v_coupon_id IS NOT NULL AND NOT COALESCE(v_coupon_allow_stacking, false) THEN
    v_discount := 0;
  ELSE
    v_discount := ROUND(v_total * v_rate / 100.0);
  END IF;

  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee + v_holiday_extra_fee, 0);

  UPDATE orders
  SET    total_amount          = v_total,
         discount_amount       = v_discount,
         coupon_discount_amount = v_coupon_discount,
         holiday_extra_fee     = v_holiday_extra_fee,
         final_amount          = v_final
  WHERE  id = p_order_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$function$;
