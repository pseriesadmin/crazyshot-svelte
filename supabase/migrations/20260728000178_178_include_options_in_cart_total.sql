-- Migration 178: calculate_cart_total에 옵션상품 금액(reservation_options) 합산 추가
-- 배경: Migration 176에서 reservation_options 테이블 + set_reservation_options RPC를
--   신규 추가했으나, calculate_cart_total(Migration 173)은 그보다 하루 먼저 작성되어
--   옵션 금액을 전혀 참조하지 않는 상태였음 — 상품상세에서 옵션을 선택해도 카트 합계·
--   결제금액에 전혀 반영되지 않는 결함 확인(Stephen 검증 요청 → 확인 → 수정 승인, 2026-07-28).
-- 조치: 기존 대여요금 계산 루프에 예약별 reservation_options 합계(unit_price × qty)를
--   더해 subtotal에 포함. 로직·반환 컬럼명은 Migration 173과 동일하게 유지.

DROP FUNCTION IF EXISTS public.calculate_cart_total(bigint[]);

CREATE OR REPLACE FUNCTION public.calculate_cart_total(p_reservation_ids bigint[])
 RETURNS TABLE(subtotal numeric, discount_amount numeric, final_total numeric, deposit_required numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_grade        TEXT;
  v_rate         NUMERIC := 0;
  v_subtotal     NUMERIC := 0;
  v_deposit      NUMERIC := 0;
  r              RECORD;
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  FOR r IN
    SELECT rr.id, rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids) AND rr.user_id = v_user_id
  LOOP
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

    -- estimatedFee 알고리즘과 동일 (CalendarTimePicker.svelte 참조)
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

    -- 옵션상품 합계(Migration 176 reservation_options) — 상품상세에서 선택한 옵션 수량×단가
    SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
    INTO v_options_fee
    FROM reservation_options ro
    WHERE ro.reservation_id = r.id;

    v_subtotal := v_subtotal + v_fee + v_options_fee;
    v_deposit  := v_deposit + v_dep;
  END LOOP;

  RETURN QUERY SELECT
    v_subtotal,
    ROUND(v_subtotal * v_rate / 100.0),
    v_subtotal - ROUND(v_subtotal * v_rate / 100.0),
    v_deposit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_cart_total(bigint[]) TO authenticated;
