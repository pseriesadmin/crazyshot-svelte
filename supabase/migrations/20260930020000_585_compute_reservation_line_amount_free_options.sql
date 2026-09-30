-- Migration 585: compute_reservation_line_amount — 무료(is_free) 옵션은 본상품 범위에서 무조건 0원
-- 2026-09-30 (Stephen 확정)
--
-- 정책:
--   ① 본상품의 옵션 중 "무료 제공"(product_option_links.is_free=true)인 옵션은 대여방식·기간·시간과
--      무관하게 옵션요금과 휴무일 연장 가산을 무조건 0원으로 계산한다.
--   ② 무료 판정은 "그 본상품(예약의 메인상품)의 링크"에서만 한다. 같은 옵션 상품이 다른 본상품에서
--      유료이면 그쪽 계산에는 어떤 영향도 주지 않는다(본상품 id + 옵션 id 쌍으로만 판정).
--
-- 배경: 기존 서버 함수에는 is_free 처리가 없었다(#569는 set_reservation_options가 저장 시점에
--   unit_price를 0으로 강제할 뿐). 그 결과 무료 옵션에 활성 12h 요금 규칙이 있으면 반나절 블록(예: 25시간)에서
--   옵션 12h 정가가 청구됐다. 화면(장바구니)은 이번 변경과 함께 무료 옵션을 0으로 고정한다.
--
-- 본상품 해석: 예약 상품이 재고(자식)이면 부모 id로 환산(COALESCE(parent_product_id, id)) — 옵션 링크는
--   부모 상품 기준으로 저장된다(upsert_product_option_links는 부모에서만 편집).
--   링크는 deleted_at IS NULL만 유효(set_reservation_options #569와 동일 기준).
-- 불변: #584의 12h/24h 처리·삭제/비활성 요금 제외, 배송 잠금(N일), 휴무일 연장 넷팅, 판매전용 분기,
--   유료 옵션 산식, 반환 컬럼·시그니처·SECURITY DEFINER·search_path·권한은 그대로.

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
  v_main_parent_id UUID;
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

  SELECT COALESCE(sale_only, false), sale_price, COALESCE(parent_product_id, id)
  INTO v_is_sale, v_sale_price, v_main_parent_id
  FROM products WHERE id = r.product_id;

  IF v_is_sale THEN
    SELECT COALESCE(SUM(
             CASE WHEN opt_free.is_free THEN 0 ELSE ro.unit_price * ro.qty END
           ), 0)
    INTO v_options_fee
    FROM reservation_options ro
    LEFT JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM product_option_links pol
        WHERE pol.product_id = v_main_parent_id
          AND pol.option_product_id = ro.option_product_id
          AND pol.deleted_at IS NULL
          AND pol.is_free = true
      ) AS is_free
    ) opt_free ON true
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
        WHEN opt_free.is_free THEN 0
        WHEN opt_price.price_12h IS NOT NULL THEN
          ro.qty * (GREATEST(v_days - v_extension_days, 0) * ro.unit_price + CASE WHEN v_has_half THEN opt_price.price_12h ELSE 0 END)
        ELSE
          ro.qty * ro.unit_price
      END
    ), 0),
    COALESCE(SUM(
      CASE
        WHEN opt_free.is_free THEN 0
        WHEN opt_price.price_12h IS NOT NULL THEN ro.qty * v_extension_days * ro.unit_price * 0.5
        ELSE 0
      END
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
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM product_option_links pol
      WHERE pol.product_id = v_main_parent_id
        AND pol.option_product_id = ro.option_product_id
        AND pol.deleted_at IS NULL
        AND pol.is_free = true
    ) AS is_free
  ) opt_free ON true
  WHERE ro.reservation_id = p_reservation_id;

  v_holiday_extra_fee := v_holiday_extra_fee + v_options_holiday_extra_fee;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep, v_holiday_extra_fee;
END;
$function$;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- 스키마·데이터 변경 없음(함수 본문만 교체). 되돌리려면 직전 정의인 Migration #584
-- (supabase/migrations/20260930010000_584_compute_reservation_line_amount_halfless_days.sql)의
-- compute_reservation_line_amount CREATE OR REPLACE 본문을 그대로 다시 적용한다.
-- ⚠️ #585 적용 후 재계산(sync_order_after_composition_change 등)으로 갱신된 주문 금액은
--    롤백해도 자동으로 되돌아가지 않는다.
