-- Migration #437: 옵션상품 12h 요금을 unit_price÷2로 파생시키던 CRITICAL 오류 수정
--
-- 배경(2026-09-03, Stephen 지적 — #436 당일 즉시 발견): #436이 옵션상품의 "12시간" 요금을
--   ROUND(unit_price/2.0)으로 파생시켰다. 이는 "1일 요금이 12시간 요금의 2배"라는 잘못된
--   가정이다 — 본상품과 마찬가지로 옵션상품도 12h/24h가 서로 완전히 독립적으로 설정된 별개
--   요금이다(실데이터 확인: SONY PXW-Z90은 24h=30000/12h=25000, Sony FX6-12는
--   24h=23000/12h=53000 — 어느 쪽도 2배 관계가 아님). unit_price÷2로 계산하면 절대 안 된다.
--
-- 수정: 옵션상품 자체의 price_rules에서 그 옵션의 독립적인 12h가를 LATERAL JOIN으로 직접
--   조회해 사용한다(본상품이 이미 하던 방식과 완전히 동일 — price_rules WHERE product_id=...
--   AND duration_type='12h'). 그 옵션 상품에 12h price_rule이 아예 없으면(신규 등록 상품 등)
--   블록 가산을 적용할 근거가 없으므로 기존(#436 이전)처럼 flat(unit_price × qty)으로
--   폴백한다 — 없는 값을 추정해서 채우지 않는다.
--
-- 원칙: 기존 마이그레이션 파일은 수정하지 않고 CREATE OR REPLACE만 사용(반환타입 불변).
--   본상품 요금 산식(#435)·판매전용 분기(#416)는 전혀 변경하지 않는다.

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

  -- 옵션상품도 본상품과 동일한 블록(v_days/v_has_half)을 적용하되, 12h가는 그 옵션 상품
  -- 자체의 price_rules에서 독립적으로 조회한다(unit_price÷2 파생 절대 금지 — #437).
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
