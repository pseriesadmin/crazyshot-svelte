-- Migration #439: 배송(왕복 배송료) 잠금 예약 일수 계산 — "대여일 00:00~반납일 24:00" 포함으로 정정
--
-- 배경(2026-09-03, Stephen 재확정 — #438 당일 즉시 발견): #438은 배송 잠금 예약의 일수를
--   GREATEST(end_date - start_date, 1)(달력일 차이, 최소 1일)로 계산했다. 그러나 실제 의도는
--   "대여일 00:00 ~ 반납일 24:00" — 수령일·반납일 두 날짜 모두 온전한 하루로 청구해야 한다
--   (예: 수령일 9일 · 반납일 10일 → 날짜차이는 1이지만, 9일 하루 + 10일 하루 = 2일 청구).
--   배송은 시간 선택 자체가 없어 "수령일에 도착 ~ 반납일에 발송"까지 두 날짜 모두 고객이
--   실질적으로 점유하는 날로 보는 것이 맞다 — 시간 기준 12h 블록 산식(#435, 방문 등 시간
--   선택이 있는 방식 전용)과는 애초에 다른 산정 기준.
--
-- 수정: v_days := GREATEST(end_date - start_date, 0) + 1 (당일이어도 최소 1일 그대로 유지,
--   날짜차이가 있으면 +1일씩 증가).
--
-- 원칙: 기존 마이그레이션 파일은 수정하지 않고 CREATE OR REPLACE만 사용(반환타입 불변).
--   #435(시간 기준 12h 블록)·#437(옵션 12h 독립가)·#438의 배송잠금 판정 자체는 변경 없음 —
--   배송 잠금일 때의 일수 계산식 한 줄만 정정한다.

CREATE OR REPLACE FUNCTION public.compute_reservation_line_amount(p_reservation_id bigint)
 RETURNS TABLE(rental_fee numeric, options_fee numeric, deposit numeric)
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
  v_delivery_locked BOOLEAN;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time, rr.pickup_method
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT COALESCE(sale_only, false), sale_price INTO v_is_sale, v_sale_price
  FROM products WHERE id = r.product_id;

  -- 판매전용 상품: 날짜×요금 계산을 건너뛰고 판매금액을 그대로 사용, 옵션도 flat 유지,
  -- 보증금은 없음 (#416 그대로 — 대여기간 개념이 없는 경로이므로 12시간 블록 산식 미적용)
  IF v_is_sale THEN
    SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
    INTO v_options_fee
    FROM reservation_options ro
    WHERE ro.reservation_id = p_reservation_id;

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

  -- 배송(왕복 배송료) 잠금 판정 — 요청 A 원칙상 반납방식도 항상 동일하게 잠기므로
  -- pickup_method 하나만 확인하면 충분하다.
  SELECT EXISTS(
    SELECT 1 FROM rental_method_options rmo
    WHERE rmo.method_key = r.pickup_method
      AND rmo.is_bulk_delivery = true
      AND rmo.is_active = true
      AND rmo.deleted_at IS NULL
  ) INTO v_delivery_locked;

  IF v_delivery_locked THEN
    -- "대여일 00:00 ~ 반납일 24:00" — 수령일·반납일 두 날짜 모두 온전한 하루로 청구(#439).
    v_days     := GREATEST((r.end_date - r.start_date), 0) + 1;
    v_has_half := false;
    v_fee      := v_days * v_daily;
  ELSE
    -- 당일/다일 통합 — 총 대여시간(분)을 12시간(720분) 블록으로 올림 처리 (#435와 동일 산식)
    v_total_minutes := (r.end_date - r.start_date) * 1440
                        + (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
    IF v_total_minutes <= 0 THEN
      v_days     := 0;
      v_has_half := false;
      v_fee      := 0;
    ELSE
      v_blocks   := CEIL(v_total_minutes / 720.0)::INT;
      v_days     := v_blocks / 2;              -- INT/INT는 양수에서 floor와 동일
      v_has_half := (v_blocks % 2 = 1);
      v_fee := v_days * v_daily + (CASE WHEN v_has_half THEN v_half ELSE 0 END);
    END IF;
  END IF;

  -- 옵션상품도 본상품과 동일한 블록(v_days/v_has_half — 배송 잠금이면 포함 일수)을 적용하되,
  -- 12h가는 그 옵션 상품 자체의 price_rules에서 독립적으로 조회한다(#437 그대로).
  -- 12h price_rule이 없는 옵션은 블록 가산 없이 flat(unit_price × qty)으로 폴백.
  SELECT COALESCE(SUM(
    CASE
      WHEN opt_price.price_12h IS NOT NULL THEN
        ro.qty * (v_days * ro.unit_price + CASE WHEN v_has_half THEN opt_price.price_12h ELSE 0 END)
      ELSE
        ro.qty * ro.unit_price
    END
  ), 0)
  INTO v_options_fee
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

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;
