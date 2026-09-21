-- Migration 510: sync_order_after_composition_change — 쿠폰 할인 계산 결함 3건 수정
--
-- 배경: Stephen이 "쿠폰 선택 시 할인이 정산에 반영 안 됨"을 보고 → 코드 추적 결과
-- 이 함수(주문 최종금액 계산의 유일한 정본 — create_reservation_order·
-- cms_add_reservation_product_unit·cms_remove_reservation_product_unit 3곳 공유)에
-- 아래 3가지 결함이 확인됨:
--
--   ① discount_type='free_shipping' 쿠폰은 IF/ELSIF 분기(107-111행, Migration 502)에
--      해당 분기가 없어 v_coupon_discount가 항상 0으로 남음 — "배송비 할인" 쿠폰이
--      실제 정산에서 절대 할인되지 않던 근본 원인.
--   ② coupons.allow_stacking 컬럼이 이 함수(및 프로젝트 전체 어디에서도)에서 전혀
--      읽히지 않음 — "쿠폰 중복 사용 허용" 설정이 무엇을 켜고 꺼도 회원등급 할인과의
--      관계에 아무 영향이 없었음.
--   ③ (Stephen 확정, 2026-09-21) 위 ②를 해소하며 신규 정책 적용: allow_stacking=false인
--      쿠폰을 사용하면 고객이 직접 선택한 쿠폰 할인을 우선하고 회원등급 할인은 배제한다
--      (allow_stacking=true면 둘 다 함께 적용).
--
-- free_shipping 할인은 LEAST(할인값, 배송비)로 배송비 자체를 넘지 않게 캡핑한다 —
-- "배송비 할인" 쿠폰이 상품 금액까지 깎아먹는 의도치 않은 결과를 방지.

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

  -- ① 쿠폰 할인 계산(free_shipping 분기 추가) + allow_stacking 함께 조회
  v_coupon_discount := 0;
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.discount_type, c.discount_value, c.allow_stacking
      INTO v_coupon_discount_type, v_coupon_discount_value, v_coupon_allow_stacking
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_coupon_id;

    IF v_coupon_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_coupon_discount_value, 0);
    ELSIF v_coupon_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_coupon_discount_value, 0) / 100.0);
    ELSIF v_coupon_discount_type = 'free_shipping' THEN
      v_coupon_discount := LEAST(COALESCE(v_coupon_discount_value, 0), v_delivery_fee);
    END IF;
  END IF;

  -- ②③ 쿠폰이 있고 중복사용 비허용이면 회원등급 할인 배제(고객이 선택한 쿠폰 우선)
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

-- CREATE OR REPLACE(시그니처 무변경)라 기존 권한이 자동 보존된다 — 별도 GRANT 불필요.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 20260915020000_502_sync_order_holiday_extra_fee.sql의
-- CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change 블록을 그대로
-- 재실행하면 free_shipping 분기·allow_stacking 게이팅만 제거되어 원상복구된다.
-- ============================================================
