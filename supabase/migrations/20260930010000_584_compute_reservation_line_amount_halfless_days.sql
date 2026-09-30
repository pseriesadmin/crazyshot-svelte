-- Migration 584: compute_reservation_line_amount — 12시간 요금 미등록 시 24시간 단위 올림 + 삭제/비활성 요금 제외
-- 2026-09-30 (Stephen 확정)
--
-- 배경: CMS에서 요금 항목을 비우는 것은 관리자 영역이며, 없는 요금을 추정값으로 채우면 안 된다.
--   (1) 12h 요금이 없는 상품: 기존에는 v_half=0으로 처리돼 12시간 구간이 "무료"로 청구됐다
--       (25시간 → 1일 요금만, 9시간 → 0원). 이제는 12시간 블록을 만들 수 없으므로 총 대여시간을
--       24시간(1440분) 단위로 올림한 일수 × 24h 요금으로 청구한다(단 1분이라도 24시간을 넘으면 1일 추가).
--   (2) 본상품 요금 조회에 is_active/deleted_at 조건이 없어 삭제·비활성 요금(부모 요금을 비우면
--       sync_price_rules_to_children 트리거가 자식 요금을 soft-delete 처리)이 계속 청구에 사용됐다.
--       옵션 요금 조회(opt_price)와 동일하게 활성·미삭제 요금만 사용한다.
--   (3) 24h 요금이 없으면 대여요금 0(산정 불가) — 클라이언트가 "요금 미정"으로 표시하고 예약 신청을 막는다.
-- 불변: 12h 요금이 있는 상품의 산식·배송 잠금(N일)·휴무일 연장·옵션 산식·판매전용 분기·반환 컬럼·권한은 그대로.
-- 옵션: 본상품이 12h 없음이면 옵션(자체 12h 있음 포함)도 본상품과 동일한 v_days(올림 일수)·v_has_half=false를 따른다.

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
  v_half_missing  BOOLEAN;
  v_daily_missing BOOLEAN;
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
  WHERE product_id = r.product_id
    AND is_active = true
    AND deleted_at IS NULL;

  v_daily_missing := (v_daily IS NULL);
  v_half_missing  := (v_half IS NULL);
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
    ELSIF v_half_missing THEN
      -- 12h 요금 미등록: 12시간 블록 불가 → 24시간(1440분) 단위 올림 일수 × 24h 요금
      v_days     := CEIL(v_total_minutes / 1440.0)::INT;
      v_has_half := false;
      v_fee      := v_days * v_daily;
    ELSE
      v_blocks   := CEIL(v_total_minutes / 720.0)::INT;
      v_days     := v_blocks / 2;
      v_has_half := (v_blocks % 2 = 1);
      v_fee := v_days * v_daily + (CASE WHEN v_has_half THEN v_half ELSE 0 END);
    END IF;
  END IF;

  -- 24h 요금 미등록: 대여요금 산정 불가 → 0 (클라이언트가 "요금 미정" 표시 + 예약 신청 차단)
  IF v_daily_missing THEN
    v_fee := 0;
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
$function$;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- 스키마·데이터 변경 없음(함수 본문만 교체). 되돌리려면 직전 정의인 Migration #509
-- (supabase/migrations/20260919010000_509_holiday_extra_fee_policy_reversal.sql)의
-- compute_reservation_line_amount CREATE OR REPLACE 본문을 그대로 다시 적용한다.
-- (#509 이후 이 함수를 재정의한 마이그레이션은 #584 이전까지 없음 — 2026-09-30 확인.
--  Production 적용 전 pg_get_functiondef 스냅샷을 저장해 두면 더 정확한 복원 근거가 된다.)
-- ⚠️ #584 적용 후 재계산(sync_order_after_composition_change 등)으로 갱신된 주문 금액은
--    롤백해도 자동으로 되돌아가지 않는다.
