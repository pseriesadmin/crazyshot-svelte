-- Migration #416: 판매전용(sale_only) 상품 "구매" 흐름 지원
-- 배경(2026-09-01 발견): 판매전용 상품이 장바구니/결제에서 대여상품과 완전히 동일한
--   날짜기반 요금계산·예약승인 흐름을 타고 있어, ①실제 판매금액(sale_price)이 결제금액에
--   전혀 반영되지 않고 ②전자계약 서명이 없으면 영원히 확정되지 않으며 ③확정되어도 재고가
--   자동으로 소진 처리되지 않는 3중 결함이 있었다. Stephen 확정 사항 3가지를 반영:
--   1) rental_reservations.duration_type에 'purchase' 값을 허용해 "이 예약은 구매 건이다"를
--      시스템적으로 구별 가능하게 한다.
--   2) compute_reservation_line_amount — 판매전용 상품은 날짜×요금 계산을 건너뛰고
--      products.sale_price를 그대로 결제금액으로 사용(보증금 없음).
--   3) try_confirm_reservation — 판매전용 상품은 전자계약 서명 여부와 무관하게 결제완료만
--      으로 즉시 confirmed 처리.
--   4) update_reservation_status — confirmed로 전환되는 순간 판매전용 상품이면 그 재고
--      (자식 유닛)를 자동으로 is_active=false 처리(재고에서 즉시 제외).
-- 원칙: 대여 상품 경로의 기존 로직·계산 결과는 전혀 변경하지 않는다(sale_only=false면
--   100% 기존과 동일하게 동작). 기존 마이그레이션 파일은 수정하지 않고 CREATE OR REPLACE만
--   사용(반환타입 불변).

-- 1) duration_type CHECK 제약에 'purchase' 추가
ALTER TABLE rental_reservations DROP CONSTRAINT IF EXISTS rental_reservations_duration_type_check;
ALTER TABLE rental_reservations ADD CONSTRAINT rental_reservations_duration_type_check
  CHECK (duration_type = ANY (ARRAY['12h'::text, '24h'::text, '1day'::text, 'monthly'::text, 'purchase'::text]));

-- 2) compute_reservation_line_amount — 판매전용 상품 분기 추가
CREATE OR REPLACE FUNCTION public.compute_reservation_line_amount(p_reservation_id bigint)
 RETURNS TABLE(rental_fee numeric, options_fee numeric, deposit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r              RECORD;
  v_is_sale      BOOLEAN;
  v_sale_price   NUMERIC;
  v_daily        NUMERIC;
  v_half         NUMERIC;
  v_dep          NUMERIC;
  v_p_hour       INT;
  v_p_min        INT;
  v_r_hour       INT;
  v_r_min        INT;
  v_total_days   INT;
  v_remain_hours INT;
  v_mins         INT;
  v_fee          NUMERIC;
  v_options_fee  NUMERIC;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT COALESCE(sale_only, false), sale_price INTO v_is_sale, v_sale_price
  FROM products WHERE id = r.product_id;

  SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
  INTO v_options_fee
  FROM reservation_options ro
  WHERE ro.reservation_id = p_reservation_id;

  -- 판매전용 상품: 날짜×요금 계산을 건너뛰고 판매금액을 그대로 사용, 보증금은 없음
  IF v_is_sale THEN
    RETURN QUERY SELECT COALESCE(v_sale_price, 0)::NUMERIC, v_options_fee, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT MAX(price) FILTER (WHERE duration_type = '24h'),
         MAX(price) FILTER (WHERE duration_type = '12h'),
         MAX(deposit_amount) FILTER (WHERE duration_type = '24h')
  INTO v_daily, v_half, v_dep
  FROM price_rules
  WHERE product_id = r.product_id;

  v_daily := COALESCE(v_daily, 0);
  v_half  := COALESCE(v_half, 0);
  v_dep   := COALESCE(v_dep, 0);

  v_p_hour := COALESCE(NULLIF(split_part(r.pickup_time, ':', 1), '')::INT, 0);
  v_p_min  := COALESCE(NULLIF(split_part(r.pickup_time, ':', 2), '')::INT, 0);
  v_r_hour := COALESCE(NULLIF(split_part(r.return_time, ':', 1), '')::INT, 0);
  v_r_min  := COALESCE(NULLIF(split_part(r.return_time, ':', 2), '')::INT, 0);

  IF r.start_date = r.end_date THEN
    v_mins := (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
    IF v_mins <= 0 THEN
      v_fee := 0;
    ELSIF v_mins <= 720 THEN
      v_fee := v_half;
    ELSE
      v_fee := v_daily;
    END IF;
  ELSE
    v_total_days := (r.end_date - r.start_date);
    v_fee := v_total_days * v_daily;
    v_remain_hours := ((v_r_hour - v_p_hour) % 24 + 24) % 24;
    IF v_remain_hours >= 12 THEN
      v_fee := v_fee + v_half;
    END IF;
  END IF;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;

-- 3) try_confirm_reservation — 판매전용 상품은 계약서명 없이 결제완료만으로 즉시 확정
CREATE OR REPLACE FUNCTION public.try_confirm_reservation(p_reservation_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status               TEXT;
  v_payment_confirmed_at TIMESTAMPTZ;
  v_product_id           UUID;
  v_is_sale              BOOLEAN;
  v_signed                BOOLEAN;
  v_result                JSONB;
BEGIN
  SELECT status, payment_confirmed_at, product_id
  INTO v_status, v_payment_confirmed_at, v_product_id
  FROM public.rental_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'hold' OR v_payment_confirmed_at IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 판매전용(sale_only) 상품은 전자계약 개념이 적용되지 않으므로 서명 여부와 무관하게
  -- 결제 완료만으로 즉시 확정한다(Stephen 확정, 2026-09-01).
  SELECT COALESCE(sale_only, false) INTO v_is_sale FROM public.products WHERE id = v_product_id;
  IF v_is_sale THEN
    v_result := public.update_reservation_status(p_reservation_id, 'confirmed');
    RETURN COALESCE((v_result ->> 'ok')::boolean, false);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.contract_signings cs ON cs.contract_id = c.id
    WHERE cs.signed_at IS NOT NULL
      AND (
        c.reservation_id = p_reservation_id
        OR c.reservation_id IN (
             SELECT oi2.reservation_id
             FROM public.order_items oi2
             WHERE oi2.order_id = (
               SELECT oi.order_id FROM public.order_items oi
               WHERE oi.reservation_id = p_reservation_id
               LIMIT 1
             )
           )
      )
  ) INTO v_signed;

  IF NOT v_signed THEN
    RETURN FALSE;
  END IF;

  v_result := public.update_reservation_status(p_reservation_id, 'confirmed');
  RETURN COALESCE((v_result ->> 'ok')::boolean, false);
END;
$function$;

-- 4) update_reservation_status — confirmed 전환 시 판매전용 상품 재고 자동 제외
CREATE OR REPLACE FUNCTION public.update_reservation_status(p_reservation_id bigint, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_pickup_method  TEXT;
  v_return_method  TEXT;
  v_product_id     UUID;
  v_allowed_next   TEXT;
  v_updated_count  INT;
  v_is_sale        BOOLEAN;
BEGIN
  SELECT status, pickup_method, return_method, product_id
    INTO v_current_status, v_pickup_method, v_return_method, v_product_id
  FROM rental_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  IF v_current_status IN ('completed', 'cancelled', 'damage_claimed') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 종료된 예약은 상태를 변경할 수 없습니다.');
  END IF;

  IF p_new_status IN ('cancelled', 'damage_claimed') THEN
    UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
    WHERE id = p_reservation_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_allowed_next := CASE v_current_status
    WHEN 'pending'           THEN 'hold'
    WHEN 'hold'               THEN 'confirmed'
    WHEN 'confirmed'          THEN CASE WHEN v_pickup_method = 'visit' THEN 'in_use' ELSE 'shipped' END
    WHEN 'shipped'            THEN 'in_use'
    WHEN 'in_use'             THEN CASE WHEN v_return_method = 'visit' THEN 'returned' ELSE 'return_requested' END
    WHEN 'return_requested'   THEN 'returned'
    WHEN 'returned'           THEN 'completed'
    ELSE NULL
  END;

  IF v_allowed_next IS NULL OR p_new_status <> v_allowed_next THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('허용되지 않은 상태 전환입니다. (현재: %s → 요청: %s)', v_current_status, p_new_status)
    );
  END IF;

  UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
  WHERE id = p_reservation_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
  END IF;

  -- #416(2026-09-01): 판매전용(sale_only) 상품이 confirmed로 전환되는 순간 그 재고(자식
  -- 유닛)를 자동으로 대여 불가 처리한다(Stephen 확정 — 판매 완료 즉시 재고 제외). 관리자
  -- 수동 "승인하기" 우회 경로도 이 함수를 그대로 거치므로 동일하게 적용된다.
  IF p_new_status = 'confirmed' AND v_product_id IS NOT NULL THEN
    SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
    IF v_is_sale THEN
      UPDATE products SET is_active = false WHERE id = v_product_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- ALTER TABLE rental_reservations DROP CONSTRAINT rental_reservations_duration_type_check;
-- ALTER TABLE rental_reservations ADD CONSTRAINT rental_reservations_duration_type_check
--   CHECK (duration_type = ANY (ARRAY['12h'::text, '24h'::text, '1day'::text, 'monthly'::text]));
-- (compute_reservation_line_amount / try_confirm_reservation / update_reservation_status는
--  이 파일 이전의 CREATE OR REPLACE 문을 재실행해 복구)
-- ============================================================
