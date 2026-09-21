-- Migration 509: compute_reservation_line_amount — 휴무일 연장요금 정책 전면 개정
-- (2026-09-19, Stephen 확정 — "심각한 변경정책 미적용 오류" 지적 후 CRITICAL 즉시수정)
--
-- 배경: rental-fee-policy.md §5(2026-09-04 Stephen 3차 최종 확정, Migration #501)는
-- "연장일수 N 중 하루는 무료, 나머지(N-1)일만 daily요율의 50%"였고, 옵션상품은 이 특례가
-- 아예 미적용(연장일도 정상가 그대로 청구)이었다. 2026-09-19 실사용 검증 중 Stephen이 이
-- 두 가지를 모두 명시적으로 뒤집었다:
--   1) "첫날 무료" 예외 완전 폐기 — 연장일수 N 전체에 대해 daily요율의 50%를 부과한다.
--   2) 옵션상품도 본상품과 동일하게 이 50% 할인 요금을 부과한다(과거엔 정상가 그대로
--      청구되던 것을 옵션 자체 요율 기준으로 50%만 부과하도록 교체).
--
-- 새 공식(한쪽/양쪽 구분 없는 단일 규칙, 기존 원칙 유지):
--   N = pickup_holiday_extra_days + return_holiday_extra_days
--   본상품 holiday_extra_fee = N × daily(본상품 24h요율) × 0.5
--   옵션별 holiday_extra_fee = N × unit_price(그 옵션 24h요율) × 0.5 × qty (12h요율 없는
--     flat 옵션은 "일" 단위 개념이 없어 제외 — 본상품·클라이언트와 동일 폴백 원칙)
--   반환 holiday_extra_fee 컬럼 = 본상품분 + 옵션 전체 합산분(하나의 컬럼에 통합 — 이중할인
--     방지 원칙상 둘 다 v_total/discount 기준액 밖에서 가산돼야 하므로 굳이 컬럼을 나눌
--     이유가 없음)
--   본상품 rental_fee / 옵션 options_fee 자체는 기존과 동일하게 "연장 전 원래 일수" 기준으로
--     넷팅(정상가에서 extension_days×daily를 빼는 방식) — 이 넷팅 로직 자체는 무변경, 옵션도
--     이번에 동일 넷팅을 새로 적용(과거엔 옵션에 넷팅 자체가 없어 연장일도 정상가로 청구됐음).
--
-- 파라미터 목록 변경 없음(단일 bigint) → DROP 없이 CREATE OR REPLACE만 사용해 기존
-- GRANT/REVOKE(Migration #503, service_role 전용)를 그대로 보존한다.

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
  -- 2026-09-19: "첫날 무료" 예외 폐기 — N 전체에 50% 부과(과거 GREATEST(N-1,0) 아님)
  v_holiday_extra_fee := v_extension_days * v_daily * 0.5;
  v_fee := GREATEST(v_fee - (v_extension_days * v_daily), 0);

  -- 2026-09-19: 옵션상품도 (a) 연장일수만큼 정상가에서 넷팅 + (b) 그 연장일수에 대해
  -- 옵션 자체 요율의 50%를 별도 가산 — 과거엔 (a)(b) 둘 다 없이 연장일도 정상가 그대로였음.
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
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 501의 본문(첫날 무료 + 옵션 특례 미적용)으로 되돌리려면
-- 20260915010000_501_holiday_extension_reintegration.sql의 해당
-- CREATE OR REPLACE FUNCTION 블록을 그대로 재실행할 것(DROP 불필요 —
-- 이번 마이그레이션도 파라미터 목록을 바꾸지 않았음).
-- ============================================================
