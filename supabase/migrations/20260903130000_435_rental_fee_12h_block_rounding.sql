-- Migration #435: 대여요금 산식 — 12시간 블록 올림(ceil) 방식으로 재설계
--
-- 배경(2026-09-03, Stephen 확정): 기존 compute_reservation_line_amount(다일 대여 분기)는
--   "잔여시간이 시(hour) 단위로 12시간 이상"일 때만 12h요율을 가산했다
--   (예: 1박2일 + 잔여 9시간 → daily만 부과, 가산 없음).
-- 실제 서비스 의도는 "총 대여시간이 24시간을 조금이라도 초과하면 즉시 +12시간 요금이
--   붙는다"였음 — 총 대여시간(분)을 720분(12시간) 단위 블록으로 올림(ceil) 처리해
--   블록 2개=1일 요율, 홀수 블록이 남으면 12시간(half)요율을 가산하는 방식으로 교체한다.
--   이 방식은 당일/다일 대여 분기를 하나의 산식으로 통합한다.
--   (클라이언트 미리보기 정합 구현: src/lib/utils/cartRentalFee.ts calcRentalFee/
--    calcRentalPeriodParts — "총 대여기간" 표시 라벨도 동일 블록 경계를 사용)
--
-- 예) 3시간 → 1블록(half만) / 20시간 → 2블록(daily만) / 정확히 24시간 → 2블록(daily만,
--     경계값은 가산 없음) / 25시간(24h를 1시간만 초과) → 3블록(daily+half, 즉시 가산) /
--     정확히 36시간 → 3블록(daily+half, 아직 2일 아님) / 36시간+1분 → 4블록(2×daily)
--
-- 원칙: 기존 마이그레이션 파일은 수정하지 않고 CREATE OR REPLACE만 사용(반환타입 불변).
--   판매전용(sale_only) 분기·옵션금액·보증금 로직은 전혀 변경하지 않는다(#416 그대로 유지).

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

  SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
  INTO v_options_fee
  FROM reservation_options ro
  WHERE ro.reservation_id = p_reservation_id;

  -- 판매전용 상품: 날짜×요금 계산을 건너뛰고 판매금액을 그대로 사용, 보증금은 없음 (#416 그대로)
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

  -- 당일/다일 통합 — 총 대여시간(분)을 12시간(720분) 블록으로 올림 처리
  v_total_minutes := (r.end_date - r.start_date) * 1440
                      + (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);

  IF v_total_minutes <= 0 THEN
    v_fee := 0;
  ELSE
    v_blocks   := CEIL(v_total_minutes / 720.0)::INT;
    v_days     := v_blocks / 2;              -- INT/INT는 양수에서 floor와 동일
    v_has_half := (v_blocks % 2 = 1);
    v_fee := v_days * v_daily + (CASE WHEN v_has_half THEN v_half ELSE 0 END);
  END IF;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;
