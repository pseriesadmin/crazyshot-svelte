-- Migration #436: 옵션상품 요금도 본상품과 동일한 12시간 블록 산식 적용
--
-- 배경(2026-09-03, Stephen 확정 — 2026-08-18 결정 번복): 지금까지 옵션상품(reservation_options)은
--   대여기간과 무관하게 unit_price × qty 고정금액으로만 청구됐다(2026-08-18 당시 "옵션은 기간별
--   요금이 실제로 없다"고 확정했던 설계 — src/routes/cart/+page.svelte:2990 주석 참고). 이번
--   세션에서 Stephen이 "본상품 + 옵션상품 동일 적용해 합산"으로 확정해 이 설계를 뒤집는다:
--   옵션의 unit_price를 "1일(24h)" 기준가로, unit_price/2(반올림)를 "12시간" 기준가로 보고
--   본상품과 완전히 동일한 12시간 블록 올림(#435) 산식·경계를 그대로 적용한다.
--
-- 적용 범위: 일반 대여 상품에 딸린 옵션만 해당. 판매전용(sale_only=true, "구매") 상품에
--   딸린 옵션은 "대여기간" 개념 자체가 없으므로 기존과 동일하게 flat(unit_price × qty)
--   그대로 유지한다(#416의 판매전용 분기 원칙과 동일선상).
--
-- 예) 옵션 unit_price=10,000원인 상품을 "1박2일+잔여9시간(33시간, #435 기준 3블록)" 예약에
--   담으면: 본상품은 daily+half가 청구되는 것과 동일하게, 옵션도 1일(10,000) + 12시간(5,000)
--   = 15,000원이 청구된다(기존이라면 10,000원 고정이었음).
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

  -- 옵션상품도 본상품과 동일한 블록(v_days/v_has_half)을 그대로 적용 — unit_price를 "1일"
  -- 기준가로, ROUND(unit_price/2)를 "12시간" 기준가로 삼는다.
  SELECT COALESCE(SUM(ro.qty * (v_days * ro.unit_price
           + CASE WHEN v_has_half THEN ROUND(ro.unit_price / 2.0) ELSE 0 END)), 0)
  INTO v_options_fee
  FROM reservation_options ro
  WHERE ro.reservation_id = p_reservation_id;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;
