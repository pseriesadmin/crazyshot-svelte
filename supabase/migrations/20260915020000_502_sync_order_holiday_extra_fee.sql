-- Migration 502: sync_order_after_composition_change — holiday_extra_fee 최종금액 재통합
--
-- 배경: 원 계획(#499, cheerful-nibbling-emerson.md)은 create_reservation_order 안에서
-- holiday_extra_fee를 직접 누적·가산했으나, 2026-09-14 무관한 세션(Migration 497,
-- sync_order_after_composition_change 신설)이 그 최종금액 계산(v_total/v_discount/
-- v_coupon_discount/v_final 산출 + orders UPDATE) 전체를 create_reservation_order
-- 밖으로 빼내 공용 함수로 리팩터링하면서, holiday_extra_fee를 모르던 그 버전이
-- create_reservation_order를 덮어써 #499의 가산 로직이 흔적 없이 사라졌다(2026-09-15
-- CMS 휴무일 옵션 정밀검증 중 발견 — Stage 실제 함수정의 조회로 확인).
--
-- 이 마이그레이션은 #499를 그대로 되살리는 대신, 지금 최종금액 계산의 유일한 정본인
-- sync_order_after_composition_change(create_reservation_order·CMS
-- cms_add_reservation_product_unit·cms_remove_reservation_product_unit 3곳이 전부
-- 공유하는 함수) 위에 holiday_extra_fee 가산을 다시 통합한다 — 이렇게 하면 세 경로
-- 전부 자동으로 커버되고, 9/14 리팩터링(공용화) 성과를 되돌리지 않는다.
--
-- 집계 방식: Migration #501의 교훈(worktree QA 1차에서 발견됐던 "이번 호출 신규분만
-- 합산" 버그 — 재발행 등으로 일부 예약만 배열에 남는 경우 기존 연결 예약의 연장요금을
-- 유실시켰음)을 그대로 반영해, 매번 그 주문에 연결된 order_items 전체를 재조회해
-- compute_reservation_line_amount(oi.reservation_id).holiday_extra_fee를 재집계한다
-- (v_total과 완전히 동일한 패턴 — 부분 갱신이 아니라 항상 전체 재계산).
--
-- delivery_fee와 동일한 원칙 유지: holiday_extra_fee는 v_total(회원등급·쿠폰 %할인의
-- 계산 기준)에 포함되지 않고, 할인·포인트 차감 이후 v_final에 별도로 가산된다.

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

  -- 2026-09-15(휴무일 자동연장 요금 재통합) — delivery_fee와 동일하게 v_total(할인
  -- 계산 기준)에는 포함시키지 않고, 그 주문에 연결된 order_items 전체를 매번 재집계한다
  -- (부분 재호출 시 유실 방지 — Migration #501 설명 참고).
  SELECT COALESCE(SUM(line.holiday_extra_fee), 0)
  INTO   v_holiday_extra_fee
  FROM   order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS line
  WHERE  oi.order_id = p_order_id;

  v_discount := ROUND(v_total * v_rate / 100.0);

  v_coupon_discount := 0;
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.discount_type, c.discount_value
      INTO v_coupon_discount_type, v_coupon_discount_value
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_coupon_id;

    IF v_coupon_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_coupon_discount_value, 0);
    ELSIF v_coupon_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_coupon_discount_value, 0) / 100.0);
    END IF;
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
-- Migration 20260914050000_497_sync_order_after_composition_change.sql의
-- CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change 블록을 그대로
-- 재실행하면 holiday_extra_fee 집계·가산 로직만 제거되어 원상복구된다.
-- ============================================================
