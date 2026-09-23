-- Migration 534: sync_order_after_composition_change — 다중쿠폰(order_coupons) 정산 반영
--   (쿠폰 다중중첩 체크아웃 구조 전환 — Phase 1 of 6)
--
-- 이 함수(주문 최종금액 계산의 유일한 정본 — create_reservation_order·
-- cms_add_reservation_product_unit·cms_remove_reservation_product_unit 3곳 공유,
-- Migration 511 최신본)를 orders.selected_coupon_id(단일) 대신 order_coupons(다중)
-- 테이블을 조회하도록 전환한다.
--
-- §할인계산정책 순차 산식: fixed 쿠폰 합산 → percentage 쿠폰 coupon_id 오름차순 순차적용
-- (max_discount_amount 캡, 매 단계 잔액 갱신) → free_shipping은 배송비 한도로 캡.
-- allow_stacking/allow_with_points는 선택된 쿠폰 중 하나라도 false면 회원등급 할인/포인트를
-- 배제한다(Migration 511의 기존 단일쿠폰 판정을 BOOL_AND 집계로 다중에 확장 — 신규 정책
-- 아님, 기존 판정 로직을 그대로 다중에 적용).
--
-- ⚠️ 하위호환 안전장치: 이 주문에 order_coupons 행이 하나도 없는데(v_has_coupons=false)
-- orders.selected_coupon_id(레거시 단일값 컬럼)가 남아있으면, Migration 511의 기존
-- 단일쿠폰 계산 로직 그대로 폴백 적용한다 — 이번 마이그레이션 이전에 생성된 기존 주문
-- (order_coupons 테이블 자체가 존재하지 않던 시절 생성됨)의 할인액이 이 함수 재호출
-- (예: CMS에서 주문 구성 변경) 시 사라지는 회귀를 방지하기 위함.

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
  v_holiday_extra_fee     NUMERIC := 0;
  v_final                 NUMERIC := 0;
  v_points                INTEGER;
  v_delivery_fee          INTEGER;
  v_canonical_code        TEXT;
  v_legacy_coupon_id      UUID;
  -- ↓ 다중쿠폰 정산 전용
  v_fixed_sum             NUMERIC := 0;
  v_pct_sum               NUMERIC := 0;
  v_fs_sum_raw            NUMERIC := 0;
  v_running_balance       NUMERIC := 0;
  v_all_allow_stacking    BOOLEAN := true;
  v_all_allow_with_points BOOLEAN := true;
  v_has_coupons           BOOLEAN := false;
  -- ↓ 레거시 단일쿠폰 폴백(하위호환) 전용
  v_legacy_discount_type  TEXT;
  v_legacy_discount_value NUMERIC;
  v_legacy_allow_stacking BOOLEAN := false;
  v_legacy_max_discount   NUMERIC;
  v_legacy_allow_with_points BOOLEAN := true;
  cp                      RECORD;
BEGIN
  SELECT user_id, selected_coupon_id, selected_points, delivery_fee
  INTO   v_user_id, v_legacy_coupon_id, v_points, v_delivery_fee
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

  -- ── 다중쿠폰 정산(order_coupons 기준) ──────────────────────────────────────
  v_fixed_sum  := 0;
  v_pct_sum    := 0;
  v_fs_sum_raw := 0;
  v_all_allow_stacking    := true;
  v_all_allow_with_points := true;
  v_has_coupons := false;

  FOR cp IN
    SELECT oc.id AS order_coupon_id, oc.user_coupon_id, oc.coupon_id,
           c.discount_type, c.discount_value, c.max_discount_amount,
           c.allow_stacking, c.allow_with_points
    FROM order_coupons oc
    JOIN coupons c ON c.id = oc.coupon_id
    WHERE oc.order_id = p_order_id
  LOOP
    v_has_coupons := true;
    v_all_allow_stacking    := v_all_allow_stacking    AND COALESCE(cp.allow_stacking, false);
    v_all_allow_with_points := v_all_allow_with_points AND COALESCE(cp.allow_with_points, true);

    IF cp.discount_type = 'fixed' THEN
      v_fixed_sum := v_fixed_sum + COALESCE(cp.discount_value, 0);
      UPDATE order_coupons SET discount_amount = COALESCE(cp.discount_value, 0) WHERE id = cp.order_coupon_id;
    ELSIF cp.discount_type = 'free_shipping' THEN
      v_fs_sum_raw := v_fs_sum_raw + COALESCE(cp.discount_value, 0);
      UPDATE order_coupons SET discount_amount = COALESCE(cp.discount_value, 0) WHERE id = cp.order_coupon_id;
    END IF;
  END LOOP;

  IF v_has_coupons THEN
    v_running_balance := GREATEST(v_total - v_fixed_sum, 0);

    FOR cp IN
      SELECT oc.id AS order_coupon_id, c.discount_value, c.max_discount_amount
      FROM order_coupons oc
      JOIN coupons c ON c.id = oc.coupon_id
      WHERE oc.order_id = p_order_id AND c.discount_type = 'percentage'
      ORDER BY oc.coupon_id ASC
    LOOP
      DECLARE
        v_step_discount NUMERIC;
      BEGIN
        v_step_discount := ROUND(v_running_balance * COALESCE(cp.discount_value, 0) / 100.0);
        IF cp.max_discount_amount IS NOT NULL AND cp.max_discount_amount > 0 THEN
          v_step_discount := LEAST(v_step_discount, cp.max_discount_amount);
        END IF;
        v_pct_sum := v_pct_sum + v_step_discount;
        v_running_balance := GREATEST(v_running_balance - v_step_discount, 0);
        UPDATE order_coupons SET discount_amount = v_step_discount WHERE id = cp.order_coupon_id;
      END;
    END LOOP;

    v_coupon_discount := v_fixed_sum + v_pct_sum + LEAST(v_fs_sum_raw, v_delivery_fee);

    IF NOT v_all_allow_stacking THEN
      v_discount := 0;
    ELSE
      v_discount := ROUND(v_total * v_rate / 100.0);
    END IF;

    IF NOT v_all_allow_with_points THEN
      v_points := 0;
    END IF;
  ELSIF v_legacy_coupon_id IS NOT NULL THEN
    -- ── 하위호환 폴백: order_coupons 행이 없는 레거시 주문(이번 마이그레이션 이전 생성) ──
    -- Migration 511의 기존 단일쿠폰 로직 그대로.
    SELECT c.discount_type, c.discount_value, c.allow_stacking, c.max_discount_amount, c.allow_with_points
      INTO v_legacy_discount_type, v_legacy_discount_value, v_legacy_allow_stacking, v_legacy_max_discount, v_legacy_allow_with_points
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_legacy_coupon_id;

    IF v_legacy_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_legacy_discount_value, 0);
    ELSIF v_legacy_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_legacy_discount_value, 0) / 100.0);
      IF v_legacy_max_discount IS NOT NULL AND v_legacy_max_discount > 0 THEN
        v_coupon_discount := LEAST(v_coupon_discount, v_legacy_max_discount);
      END IF;
    ELSIF v_legacy_discount_type = 'free_shipping' THEN
      v_coupon_discount := LEAST(COALESCE(v_legacy_discount_value, 0), v_delivery_fee);
    END IF;

    IF NOT COALESCE(v_legacy_allow_with_points, true) THEN
      v_points := 0;
    END IF;

    IF NOT COALESCE(v_legacy_allow_stacking, false) THEN
      v_discount := 0;
    ELSE
      v_discount := ROUND(v_total * v_rate / 100.0);
    END IF;
  ELSE
    -- 쿠폰 선택 없음
    v_coupon_discount := 0;
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

-- CREATE OR REPLACE(시그니처 무변경)라 기존 권한이 자동 보존된다 — 별도 GRANT 불필요.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 511의 CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change
-- 블록을 그대로 재실행하면 다중쿠폰(order_coupons) 정산 + 레거시 폴백 로직이 제거되어
-- 원상복구된다(단일 orders.selected_coupon_id 기준으로 회귀).
-- ============================================================
