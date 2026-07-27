-- Migration 173: calculate_cart_total 요금정책(price_rules) 기준 재작성
-- 배경:
--   ① 기존 함수는 checkout/+page.server.ts가 보내는 파라미터(p_reservation_ids, p_user_id)
--     중 p_user_id를 받는 오버로드가 존재하지 않아 호출이 매번 실패(PGRST202)했음.
--   ② 함수 반환 컬럼명도 호출부 기대값(subtotal/discount_amount/final_total/deposit_required)과
--     달랐고(total_amount/discount_amount/final_amount, deposit_required 없음), 내부 계산도
--     더 이상 쓰지 않는 상품 컬럼(base_price_daily/weekly/monthly)을 참조하고 있었음.
--   → 실질적으로 예약 카트 합계는 한 번도 정상 계산된 적이 없는 상태였음.
--
-- 조치: 상품상세 렌탈요금 계산기(CalendarTimePicker.svelte estimatedFee)와 동일한 로직으로
--   price_rules(12h/24h) + rental_reservations.pickup_time/return_time 기준 재계산.
--   p_user_id 파라미터는 제거하고 auth.uid()로 대체(다른 RPC와 동일 패턴).
--   반환 컬럼명을 호출부 기대값에 맞춤: subtotal, discount_amount, final_total, deposit_required.

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
    SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time
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

    v_subtotal := v_subtotal + v_fee;
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
