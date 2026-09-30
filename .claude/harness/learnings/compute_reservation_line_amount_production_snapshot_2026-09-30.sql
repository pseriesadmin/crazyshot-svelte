-- Production(vnbpmvxruyciuuaermyh) compute_reservation_line_amount 적용 전 스냅샷 — 2026-09-30
-- pg_get_functiondef md5 = c5dfeac71cbfb6acc97564f2a21c1597 (아래 본문과 일치 검증 완료)
-- 용도: Migration #584·#585 롤백(이 본문을 그대로 재적용). ACL은 CREATE OR REPLACE가 유지: {postgres, service_role}
-- 적용 전 기준선: 진행중 예약 14건 계산값 해시 942d6e7444bcd523536c4fbc5668e15e

CREATE OR REPLACE FUNCTION public.compute_reservation_line_amount(p_reservation_id bigint)
 RETURNS TABLE(rental_fee numeric, options_fee numeric, deposit numeric, holiday_extra_fee numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r               RECORD;
  v_is_sale       BOOLEAN;
  v_sale_price    NUMERIC;
  v_daily         NUMERIC;
  v_half          NUMERIC;
  v_dep           NUMERIC;
  v_p_hour        INT;
  v_p_min         INT;
  v_r_hour        INT;
  v_r_min         INT;
  v_total_minutes INT;
  v_blocks        INT;
  v_days          INT;
  v_has_half      BOOLEAN;
  v_fee           NUMERIC;
  v_options_fee   NUMERIC;
  v_options_holiday_extra_fee NUMERIC;
  v_delivery_locked BOOLEAN;
  v_extension_days  INT;
  v_holiday_extra_fee NUMERIC;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time,
         rr.pickup_method, rr.pickup_holiday_extra_days, rr.return_holiday_extra_days
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT COALESCE(sale_only, false), sale_price INTO v_is_sale, v_sale_price
  FROM products WHERE id = r.product_id;

  IF v_is_sale THEN
    SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
    INTO v_options_fee
    FROM reservation_options ro
    WHERE ro.reservation_id = p_reservation_id;

    RETURN QUERY SELECT COALESCE(v_sale_price, 0)::NUMERIC, v_options_fee, 0::NUMERIC, 0::NUMERIC;
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

  SELECT EXISTS(
    SELECT 1 FROM rental_method_options rmo
    WHERE rmo.method_key = r.pickup_method
      AND rmo.is_delivery_type = true
      AND rmo.is_active = true
      AND rmo.deleted_at IS NULL
  ) INTO v_delivery_locked;

  IF v_delivery_locked THEN
    v_days     := GREATEST((r.end_date - r.start_date), 0) + 1;
    v_has_half := false;
    v_fee      := v_days * v_daily;
  ELSE
    v_total_minutes := (r.end_date - r.start_date) * 1440
                        + (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
    IF v_total_minutes <= 0 THEN
      v_days     := 0;
      v_has_half := false;
      v_fee      := 0;
    ELSE
      v_blocks   := CEIL(v_total_minutes / 720.0)::INT;
      v_days     := v_blocks / 2;
      v_has_half := (v_blocks % 2 = 1);
      v_fee := v_days * v_daily + (CASE WHEN v_has_half THEN v_half ELSE 0 END);
    END IF;
  END IF;

  v_extension_days := COALESCE(r.pickup_holiday_extra_days, 0) + COALESCE(r.return_holiday_extra_days, 0);
  v_holiday_extra_fee := v_extension_days * v_daily * 0.5;
  v_fee := GREATEST(v_fee - (v_extension_days * v_daily), 0);

  SELECT
    COALESCE(SUM(
      CASE
        WHEN opt_price.price_12h IS NOT NULL THEN
          ro.qty * (GREATEST(v_days - v_extension_days, 0) * ro.unit_price + CASE WHEN v_has_half THEN opt_price.price_12h ELSE 0 END)
        ELSE
          ro.qty * ro.unit_price
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN opt_price.price_12h IS NOT NULL THEN ro.qty * v_extension_days * ro.unit_price * 0.5 ELSE 0 END
    ), 0)
  INTO v_options_fee, v_options_holiday_extra_fee
  FROM reservation_options ro
  LEFT JOIN LATERAL (
    SELECT MAX(pr.price) AS price_12h
    FROM price_rules pr
    WHERE pr.product_id = ro.option_product_id
      AND pr.duration_type = '12h'
      AND pr.is_active = true
      AND pr.deleted_at IS NULL
  ) opt_price ON true
  WHERE ro.reservation_id = p_reservation_id;

  v_holiday_extra_fee := v_holiday_extra_fee + v_options_holiday_extra_fee;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep, v_holiday_extra_fee;
END;
$function$
