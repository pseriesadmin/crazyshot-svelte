-- Migration 501: 휴무일 포함 배송 연장 요금 로직 — 고립 worktree → git 이력 역커밋
--
-- 배경(CRITICAL, 2026-09-15 발견): 별도 세션이 이 기능(계획서:
-- /Users/stevenmac/.claude/plans/cheerful-nibbling-emerson.md)의 DB 스키마·RPC를
-- Stage(ezyvffjvuwmtuhpxdjrw)에 2026-09-12 이미 직접 apply_migration으로 적용해뒀으나,
-- 그 세션의 커밋(마이그레이션 파일 + 화면 코드)은 격리된 git worktree
-- (.claude/worktrees/agent-a02b1ad185045b896)에만 존재하고 stage 브랜치엔 전혀 반영되지
-- 않았다 — "DB엔 있는데 git엔 없는" 드리프트 상태였다.
--
-- 이 마이그레이션은 Stage에 이미 살아있는 다음 객체들의 실제 라이브 정의를
-- pg_get_functiondef로 직접 추출해 그대로 기록한다(내용 변경 없음, 순수 역커밋) —
-- 전부 CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS라 Stage에 재실행해도 안전한
-- 멱등 연산이며, Production에는 아직 미적용 상태다(별도 승인 후 진행).
--
-- 포함 객체:
--   1. rental_reservations.pickup_holiday_extra_days / return_holiday_extra_days
--   2. orders.holiday_extra_fee
--   3. is_courier_holiday(date) — courierClosedDates.ts::loadCourierClosedDates()와
--      동일 판정 로직의 SQL 이식
--   4. compute_holiday_extended_period(start,end,pickup_method,return_method) —
--      연속 휴무일 자동연장 계산(각 leg 최대 14회 안전판)
--   5. create_hold_reservation — p_pickup_method/p_return_method(DEFAULT NULL) 추가,
--      재고 배정 전에 연장을 먼저 계산해 이미 확장된 날짜로 배정
--   6. create_hold_reservation_with_shipment — 위 파라미터를 그대로 전달
--   7. promote_draft_reservation — 동일 파라미터 확장
--   8. compute_reservation_line_amount — 4번째 반환컬럼 holiday_extra_fee 추가,
--      rental_fee에서 연장일 정상요금분을 빼내고 별도 계산(무료1일+나머지 50%)
--
-- ⚠️ create_reservation_order의 holiday_extra_fee 합산(원 계획 #499)은 이 마이그레이션에
-- 포함하지 않는다 — 그 사이(2026-09-14) create_reservation_order의 최종금액 계산 로직
-- 자체가 sync_order_after_composition_change(Migration 497, 무관한 별도 세션)로 완전히
-- 이관됐다(CMS 예약변경·예약취소 헤더 버튼에서도 재사용되는 공용 함수로 리팩터링됨).
-- holiday_extra_fee 합산은 다음 마이그레이션(#502)에서 그 최신 구조 위에 재통합한다 —
-- 이 파일에서 create_reservation_order를 건드리면 9/14 리팩터링을 되돌리는 회귀가 된다.

-- ============================================================
-- 1. 컬럼 (이미 존재 — IF NOT EXISTS로 안전하게 재확인만)
-- ============================================================
ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_holiday_extra_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_holiday_extra_days INT NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS holiday_extra_fee NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rental_reservations.pickup_holiday_extra_days IS
  '휴무일로 인해 수령측(픽업일 전날 기준)이 며칠 앞당겨졌는지 — compute_holiday_extended_period() 산출값';
COMMENT ON COLUMN public.rental_reservations.return_holiday_extra_days IS
  '휴무일로 인해 반납측(반납일 다음날 기준)이 며칠 뒤로 늦춰졌는지 — compute_holiday_extended_period() 산출값';
COMMENT ON COLUMN public.orders.holiday_extra_fee IS
  '휴무일 연장일 요금(무료 또는 하루요금 50%, 연장일수 N 중 1일 무료+나머지 각 50%) — delivery_fee와 동일하게 할인 계산 이후 가산되는 고정값';

-- ============================================================
-- 2. is_courier_holiday(date)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_courier_holiday(p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_enable_prev_day_check boolean;
  v_enable_fixed_holidays boolean;
  v_enable_manual_holidays boolean;
  v_is_holiday boolean;
BEGIN
  SELECT enable_prev_day_check, enable_fixed_holidays, enable_manual_holidays
  INTO v_enable_prev_day_check, v_enable_fixed_holidays, v_enable_manual_holidays
  FROM delivery_cutoff_settings
  LIMIT 1;

  IF NOT COALESCE(v_enable_prev_day_check, false) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public_holidays ph
    WHERE ph.date = p_date
      AND ph.is_active = true
      AND (
        (v_enable_fixed_holidays  AND ph.holiday_type = 'national') OR
        (v_enable_manual_holidays AND ph.holiday_type = 'manual')
      )
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN true;
  END IF;

  IF v_enable_fixed_holidays AND EXTRACT(DOW FROM p_date) = 0 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_courier_holiday(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_courier_holiday(date) TO authenticated, service_role;

-- ============================================================
-- 3. compute_holiday_extended_period(...)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_holiday_extended_period(
  p_start_date date,
  p_end_date date,
  p_pickup_method text,
  p_return_method text
)
RETURNS TABLE(
  effective_start_date date,
  effective_end_date date,
  pickup_extra_days int,
  return_extra_days int
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_pickup_courier_dependent boolean;
  v_return_courier_dependent boolean;
  v_effective_start date := p_start_date;
  v_effective_end date := p_end_date;
  v_pickup_extra int := 0;
  v_return_extra int := 0;
  v_day_before date;
  v_day_after date;
  v_iterations int;
BEGIN
  SELECT COALESCE(is_courier_dependent, false) INTO v_pickup_courier_dependent
  FROM rental_method_options
  WHERE method_key = p_pickup_method AND is_active = true AND deleted_at IS NULL
  LIMIT 1;

  SELECT COALESCE(is_courier_dependent, false) INTO v_return_courier_dependent
  FROM rental_method_options
  WHERE method_key = p_return_method AND is_active = true AND deleted_at IS NULL
  LIMIT 1;

  IF COALESCE(v_pickup_courier_dependent, false) THEN
    v_iterations := 0;
    LOOP
      EXIT WHEN v_iterations >= 14;
      v_day_before := v_effective_start - 1;
      EXIT WHEN NOT is_courier_holiday(v_day_before);
      v_effective_start := v_day_before;
      v_pickup_extra := v_pickup_extra + 1;
      v_iterations := v_iterations + 1;
    END LOOP;
  END IF;

  IF COALESCE(v_return_courier_dependent, false) THEN
    v_iterations := 0;
    LOOP
      EXIT WHEN v_iterations >= 14;
      v_day_after := v_effective_end + 1;
      EXIT WHEN NOT is_courier_holiday(v_day_after);
      v_effective_end := v_day_after;
      v_return_extra := v_return_extra + 1;
      v_iterations := v_iterations + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_effective_start, v_effective_end, v_pickup_extra, v_return_extra;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_holiday_extended_period(date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_holiday_extended_period(date, date, text, text) TO authenticated, service_role;

-- ============================================================
-- 4. create_hold_reservation — p_pickup_method/p_return_method(DEFAULT NULL) 확장
-- ============================================================
DROP FUNCTION IF EXISTS public.create_hold_reservation(uuid, date, date);

CREATE OR REPLACE FUNCTION public.create_hold_reservation(
  p_product_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_method text DEFAULT NULL::text,
  p_return_method text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, reservation_id bigint, asset_id bigint, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_is_anonymous   BOOLEAN;
  v_unit_id        UUID;
  v_reservation_id BIGINT;
  v_effective_start DATE;
  v_effective_end   DATE;
  v_pickup_extra    INT;
  v_return_extra    INT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  SELECT is_anonymous INTO v_is_anonymous FROM auth.users WHERE id = v_user_id;
  IF v_is_anonymous IS TRUE THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '회원 가입 후 예약이 가능합니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '서비스 이용이 제한된 계정입니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '신용점수가 낮아 예약이 제한됩니다.';
    RETURN;
  END IF;

  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days
  INTO v_effective_start, v_effective_end, v_pickup_extra, v_return_extra
  FROM compute_holiday_extended_period(p_start_date, p_end_date, p_pickup_method, p_return_method);

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = p_product_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method,
    pickup_holiday_extra_days, return_holiday_extra_days
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    v_effective_start, v_effective_end,
    COALESCE(p_pickup_method, 'visit'), COALESCE(p_return_method, 'visit'),
    v_pickup_extra, v_return_extra
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, NULL::BIGINT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, SQLERRM;
END;
$function$;

-- ============================================================
-- 5. create_hold_reservation_with_shipment — 파라미터 그대로 전달(시그니처 무변경)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_hold_reservation_with_shipment(
  p_product_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_method text,
  p_return_method text DEFAULT NULL::text,
  p_pickup_time text DEFAULT NULL::text,
  p_return_time text DEFAULT NULL::text,
  p_duration_type text DEFAULT '24h'::text
)
RETURNS TABLE(success boolean, reservation_id bigint, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hold RECORD;
BEGIN
  SELECT * INTO v_hold FROM create_hold_reservation(
    p_product_id, p_start_date, p_end_date, p_pickup_method, p_return_method
  );

  IF NOT v_hold.success THEN
    RETURN QUERY SELECT false, NULL::BIGINT, v_hold.error_message;
    RETURN;
  END IF;

  BEGIN
    PERFORM set_reservation_shipment_method(
      v_hold.reservation_id, p_pickup_method, p_return_method, p_pickup_time, p_return_time
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE rental_reservations SET status = 'cancelled' WHERE id = v_hold.reservation_id;
    RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
    RETURN;
  END;

  IF p_duration_type IS NOT NULL THEN
    BEGIN
      PERFORM set_reservation_duration(v_hold.reservation_id, p_duration_type);
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT true, v_hold.reservation_id, 'DURATION_SAVE_FAILED:' || SQLERRM;
      RETURN;
    END;
  END IF;

  RETURN QUERY SELECT true, v_hold.reservation_id, NULL::TEXT;
END;
$function$;

-- ============================================================
-- 6. promote_draft_reservation — p_pickup_method/p_return_method(DEFAULT NULL) 확장
-- ============================================================
DROP FUNCTION IF EXISTS public.promote_draft_reservation(bigint, date, date);

CREATE OR REPLACE FUNCTION public.promote_draft_reservation(
  p_reservation_id bigint,
  p_start_date date,
  p_end_date date,
  p_pickup_method text DEFAULT NULL::text,
  p_return_method text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, reservation_id bigint, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_parent_id UUID;
  v_unit_id   UUID;
  v_effective_start DATE;
  v_effective_end   DATE;
  v_pickup_extra    INT;
  v_return_extra    INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '대여 기간을 올바르게 입력해주세요.';
    RETURN;
  END IF;

  SELECT product_id INTO v_parent_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft'
  FOR UPDATE;

  IF v_parent_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약 정보를 찾을 수 없습니다.';
    RETURN;
  END IF;

  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days
  INTO v_effective_start, v_effective_end, v_pickup_extra, v_return_extra
  FROM compute_holiday_extended_period(p_start_date, p_end_date, p_pickup_method, p_return_method);

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = v_parent_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  UPDATE rental_reservations
  SET product_id = v_unit_id,
      start_date = v_effective_start,
      end_date   = v_effective_end,
      status     = 'hold',
      pickup_holiday_extra_days = v_pickup_extra,
      return_holiday_extra_days = v_return_extra
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft';

  RETURN QUERY SELECT true, p_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;

-- ============================================================
-- 7. compute_reservation_line_amount — 4번째 반환컬럼 holiday_extra_fee 추가(반환타입
--    변경이라 DROP 필요, 42P13 회피)
-- ============================================================
DROP FUNCTION IF EXISTS public.compute_reservation_line_amount(bigint);

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
  v_holiday_extra_fee := GREATEST(v_extension_days - 1, 0) * v_daily * 0.5;
  v_fee := GREATEST(v_fee - (v_extension_days * v_daily), 0);

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

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep, v_holiday_extra_fee;
END;
$function$;

-- ============================================================
-- ROLLBACK (Stage 전용 — Production 미적용이므로 여기서만 유효)
-- ============================================================
-- 위 DROP FUNCTION 대상 3종(create_hold_reservation/promote_draft_reservation/
-- compute_reservation_line_amount)을 각 원 시그니처(3-param/3-param/4-return 없는
-- 3-return)로 되돌리려면 Migration 이전의 원본 정의를 별도 조회해 재실행해야 한다
-- (git 이력상 main 브랜치엔 애초에 신버전만 존재하므로 직전 정의가 파일로 없음 —
-- 롤백이 필요해지면 Stage 백업 스냅샷 또는 이 마이그레이션 적용 직전 pg_get_functiondef
-- 결과를 별도 보관해둘 것).
-- ============================================================
