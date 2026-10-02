-- Migration 621 — 쿠폰 정률 "합산" + 1일차 한정(first_day) 계산 (2026-10-02, Stephen 확정 정책)
--
-- 정책
--   · 정액 쿠폰 먼저 차감 → 남은 금액 R = max(총액 − Σ정액, 0)
--   · 정률 쿠폰은 순차 복리가 아니라 같은 기준 금액에 "율을 합산" 적용한다 (각 쿠폰 할인 = 기준 × 율)
--       - discount_scope='order'     : 기준 = R
--       - discount_scope='first_day' : 기준 = R1 = B1 × R / T  (B1 = 1일차 요금, T = 총액)
--     예) 미친할인 30%(order) + 방문 10%(first_day), 2일 대여 → 1일차 40%, 2일차 30%
--   · 쿠폰별 최대 할인 한도(max_discount_amount)는 쿠폰 단위로 적용
--   · 합계가 R을 넘지 않도록 coupon_id 오름차순으로 잘라낸다
--   · 무료배송: 배송비 한도(변경 없음)
--
-- 구성
--   1) compute_reservation_line_amount — 5번째 반환 컬럼 first_day_amount 추가 (요금 계산 자체는 불변)
--   2) order_first_day_base(order_id)   — 주문의 1일차 기준 금액 합계
--   3) apply_order_coupon_discounts(...) — 쿠폰별 할인 계산·order_coupons 기록의 단일 정본
--   4) create_reservation_order / sync_order_after_composition_change — 복리 루프를 3)으로 교체
--   5) 결제 전(pending) 쿠폰 주문 재계산

-- ── 1) compute_reservation_line_amount ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.compute_reservation_line_amount(bigint);

CREATE FUNCTION public.compute_reservation_line_amount(p_reservation_id bigint)
 RETURNS TABLE(rental_fee numeric, options_fee numeric, deposit numeric, holiday_extra_fee numeric, first_day_amount numeric)
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
  v_first_main    NUMERIC;
  v_first_opts    NUMERIC;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time,
         rr.pickup_method, rr.pickup_holiday_extra_days, rr.return_holiday_extra_days
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
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

    RETURN QUERY SELECT COALESCE(v_sale_price, 0)::NUMERIC, v_options_fee, 0::NUMERIC, 0::NUMERIC,
                        (COALESCE(v_sale_price, 0) + v_options_fee)::NUMERIC;
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

  IF v_daily_missing THEN
    v_fee := 0;
  END IF;

  v_extension_days := COALESCE(r.pickup_holiday_extra_days, 0) + COALESCE(r.return_holiday_extra_days, 0);
  v_holiday_extra_fee := v_extension_days * v_daily * 0.5;
  v_fee := GREATEST(v_fee - (v_extension_days * v_daily), 0);

  -- 1일차 본상품 요금: 24시간 이상 대여면 1일(24h) 요금, 그보다 짧으면(12h 블록뿐) 전체 요금
  IF v_fee <= 0 THEN
    v_first_main := 0;
  ELSIF v_days >= 1 THEN
    v_first_main := LEAST(v_daily, v_fee);
  ELSE
    v_first_main := v_fee;
  END IF;

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
    ), 0),
    -- 1일차 옵션 요금: 일 단가 옵션은 하루치(24h 미만이면 12h 단가), 정액 옵션은 전액을 1일차에 포함
    COALESCE(SUM(
      CASE
        WHEN opt_free.is_free THEN 0
        WHEN opt_price.price_12h IS NOT NULL THEN
          LEAST(
            ro.qty * (GREATEST(v_days - v_extension_days, 0) * ro.unit_price + CASE WHEN v_has_half THEN opt_price.price_12h ELSE 0 END),
            ro.qty * (CASE WHEN v_days >= 1 THEN ro.unit_price ELSE opt_price.price_12h END)
          )
        ELSE
          ro.qty * ro.unit_price
      END
    ), 0)
  INTO v_options_fee, v_options_holiday_extra_fee, v_first_opts
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

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep, v_holiday_extra_fee, (v_first_main + v_first_opts)::NUMERIC;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_reservation_line_amount(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_reservation_line_amount(bigint) TO service_role;

-- ── 2) 주문의 1일차 기준 금액 ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.order_first_day_base(p_order_id bigint)
 RETURNS numeric
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(LEAST(oi.line_total, line.first_day_amount)), 0)
  FROM order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS line
  WHERE oi.order_id = p_order_id
    AND oi.reservation_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.order_first_day_base(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_first_day_base(bigint) TO service_role;

-- ── 3) 쿠폰별 할인 계산·기록 (단일 정본) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_order_coupon_discounts(
  p_order_id       bigint,
  p_total          numeric,
  p_first_day_base numeric,
  p_delivery_fee   numeric
)
 RETURNS TABLE(coupon_discount numeric, all_allow_stacking boolean, all_allow_with_points boolean, has_coupons boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fixed       NUMERIC := 0;
  v_fs          NUMERIC := 0;
  v_pct         NUMERIC := 0;
  v_all_stack   BOOLEAN := true;
  v_all_pts     BOOLEAN := true;
  v_has         BOOLEAN := false;
  v_r           NUMERIC;
  v_remaining   NUMERIC;
  v_d           NUMERIC;
  cp            RECORD;
BEGIN
  FOR cp IN
    SELECT oc.id AS ocid, c.discount_type, c.discount_value, c.allow_stacking, c.allow_with_points
    FROM order_coupons oc
    JOIN coupons c ON c.id = oc.coupon_id
    WHERE oc.order_id = p_order_id
  LOOP
    v_has       := true;
    v_all_stack := v_all_stack AND COALESCE(cp.allow_stacking, false);
    v_all_pts   := v_all_pts   AND COALESCE(cp.allow_with_points, true);

    IF cp.discount_type = 'fixed' THEN
      v_fixed := v_fixed + COALESCE(cp.discount_value, 0);
      UPDATE order_coupons SET discount_amount = COALESCE(cp.discount_value, 0) WHERE id = cp.ocid;
    ELSIF cp.discount_type = 'free_shipping' THEN
      v_fs := v_fs + COALESCE(cp.discount_value, 0);
      UPDATE order_coupons SET discount_amount = COALESCE(cp.discount_value, 0) WHERE id = cp.ocid;
    END IF;
  END LOOP;

  IF NOT v_has THEN
    RETURN QUERY SELECT 0::NUMERIC, true, true, false;
    RETURN;
  END IF;

  v_r         := GREATEST(p_total - v_fixed, 0);
  v_remaining := v_r;

  FOR cp IN
    SELECT oc.id AS ocid, c.discount_value, c.max_discount_amount, c.discount_scope
    FROM order_coupons oc
    JOIN coupons c ON c.id = oc.coupon_id
    WHERE oc.order_id = p_order_id AND c.discount_type = 'percentage'
    ORDER BY oc.coupon_id ASC
  LOOP
    IF cp.discount_scope = 'first_day' THEN
      -- 기준 = 정액 차감 후 잔액 중 1일차 몫 (R1 = B1 × R / T)
      IF p_total > 0 THEN
        v_d := ROUND(LEAST(GREATEST(p_first_day_base, 0), p_total) * v_r * COALESCE(cp.discount_value, 0) / (p_total * 100.0));
      ELSE
        v_d := 0;
      END IF;
    ELSE
      v_d := ROUND(v_r * COALESCE(cp.discount_value, 0) / 100.0);
    END IF;

    IF cp.max_discount_amount IS NOT NULL AND cp.max_discount_amount > 0 THEN
      v_d := LEAST(v_d, cp.max_discount_amount);
    END IF;

    v_d         := LEAST(v_d, v_remaining);
    v_remaining := v_remaining - v_d;
    v_pct       := v_pct + v_d;
    UPDATE order_coupons SET discount_amount = v_d WHERE id = cp.ocid;
  END LOOP;

  RETURN QUERY SELECT v_fixed + v_pct + LEAST(v_fs, GREATEST(COALESCE(p_delivery_fee, 0), 0)),
                      v_all_stack, v_all_pts, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_order_coupon_discounts(bigint, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_order_coupon_discounts(bigint, numeric, numeric, numeric) TO service_role;

-- ── 4-a) create_reservation_order ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_reservation_order(p_user_id uuid, p_reservation_ids bigint[], p_selected_coupon_id uuid DEFAULT NULL::uuid, p_selected_points integer DEFAULT 0, p_delivery_fee integer DEFAULT 0, p_selected_coupon_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(order_id bigint, order_key text, final_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grade         TEXT;
  v_rate          NUMERIC := 0;
  v_total         NUMERIC := 0;
  v_discount      NUMERIC := 0;
  v_coupon_discount NUMERIC := 0;
  v_coupon_discount_type TEXT;
  v_coupon_discount_value NUMERIC;
  v_final         NUMERIC := 0;
  v_order_id      BIGINT;
  v_order_key     TEXT;
  v_count         INT;
  v_seq           INT;
  v_today         TEXT;
  v_coupon_id     UUID;          -- 단일값 경로 전용(하위호환)
  v_points        INTEGER;
  v_delivery_fee  INTEGER;
  v_canonical_code TEXT;
  r               RECORD;
  line            RECORD;
BEGIN
  IF p_user_id IS NULL OR p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RAISE EXCEPTION '주문을 생성할 예약이 없습니다.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM rental_reservations
  WHERE id = ANY(p_reservation_ids) AND user_id = p_user_id AND status = 'hold';

  IF v_count IS DISTINCT FROM array_length(p_reservation_ids, 1) THEN
    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  -- PRICE-UNSET-GUARD (Migration 587): 24h 요금 미등록 대여 상품은 주문 연결 자체를 차단
  IF EXISTS (
    SELECT 1
    FROM rental_reservations rr
    JOIN products pu ON pu.id = rr.product_id
    WHERE rr.id = ANY(p_reservation_ids)
      AND COALESCE(pu.sale_only, false) = false
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
      AND NOT EXISTS (
        SELECT 1 FROM price_rules pr
        WHERE pr.product_id = rr.product_id
          AND pr.duration_type = '24h'
          AND pr.is_active = true
          AND pr.deleted_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'PRICE_UNSET: 요금이 등록되지 않은 상품이 있어 예약을 신청할 수 없습니다.';
  END IF;

  -- COUPON-STACKING-GUARD (Migration 605): 2장 이상 선택 중 "쿠폰끼리 중복 허용"이 꺼진 쿠폰이 있으면 차단
  IF p_selected_coupon_ids IS NOT NULL AND array_length(p_selected_coupon_ids, 1) > 1 THEN
    IF EXISTS (
      SELECT 1 FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.id = ANY(p_selected_coupon_ids) AND uc.user_id = p_user_id AND c.allow_coupon_stacking = false
    ) THEN
      RAISE EXCEPTION 'COUPON_STACKING_NOT_ALLOWED: 중복 사용이 허용되지 않은 쿠폰이 포함되어 있습니다.';
    END IF;
  END IF;

  v_coupon_id := p_selected_coupon_id;
  IF v_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_coupons WHERE id = v_coupon_id AND user_id = p_user_id
  ) THEN
    v_coupon_id := NULL;
  END IF;
  v_points       := GREATEST(0, COALESCE(p_selected_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(p_delivery_fee, 0));

  SELECT o.id INTO v_order_id
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.reservation_id = ANY(p_reservation_ids)
  ORDER BY o.created_at ASC
  LIMIT 1;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = p_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  IF v_order_id IS NULL THEN
    v_today := TO_CHAR(NOW(), 'YYYYMMDD');
    INSERT INTO order_key_sequences (seq_date, next_seq)
    VALUES (v_today, 2)
    ON CONFLICT (seq_date) DO UPDATE SET next_seq = order_key_sequences.next_seq + 1
    RETURNING order_key_sequences.next_seq - 1 INTO v_seq;

    IF v_seq IS NULL THEN v_seq := 1; END IF;

    v_order_key := 'ORD-' || v_today || '-' || LPAD(v_seq::TEXT, 5, '0');

    INSERT INTO orders (order_key, user_id, total_amount, discount_amount, tax_amount, final_amount, status)
    VALUES (v_order_key, p_user_id, 0, 0, 0, 0, 'pending')
    RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_key INTO v_order_key FROM orders o WHERE o.id = v_order_id;
  END IF;

  FOR r IN
    SELECT rr.id, rr.product_id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, r.id, r.product_id, 1, line.rental_fee, line.rental_fee + line.options_fee);
  END LOOP;

  SELECT rr.reservation_code INTO v_canonical_code
  FROM order_items oi
  JOIN rental_reservations rr ON rr.id = oi.reservation_id
  WHERE oi.order_id = v_order_id
  ORDER BY rr.id ASC
  LIMIT 1;

  IF v_canonical_code IS NOT NULL THEN
    UPDATE rental_reservations rr
    SET reservation_code = v_canonical_code
    WHERE rr.id IN (SELECT oi.reservation_id FROM order_items oi WHERE oi.order_id = v_order_id)
      AND rr.reservation_code IS DISTINCT FROM v_canonical_code;
  END IF;

  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM order_items oi WHERE oi.order_id = v_order_id;

  v_discount := ROUND(v_total * v_rate / 100.0);

  v_coupon_discount := 0;

  IF p_selected_coupon_ids IS NOT NULL THEN
    v_coupon_id := NULL;

    DELETE FROM order_coupons oc WHERE oc.order_id = v_order_id;

    INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
    SELECT v_order_id, uc.id, uc.coupon_id, 0
    FROM user_coupons uc
    WHERE uc.id = ANY(p_selected_coupon_ids) AND uc.user_id = p_user_id
    ON CONFLICT ON CONSTRAINT order_coupons_order_id_user_coupon_id_key DO UPDATE SET discount_amount = 0;

    -- 정액 → 정률(같은 기준 합산, 1일차 한정은 1일차 몫 기준) → 무료배송, 쿠폰별 금액은 order_coupons에 기록 (Migration 621)
    SELECT h.coupon_discount INTO v_coupon_discount
    FROM apply_order_coupon_discounts(v_order_id, v_total, order_first_day_base(v_order_id), v_delivery_fee) h;
  ELSE
    IF v_coupon_id IS NOT NULL THEN
      SELECT c.discount_type, c.discount_value
        INTO v_coupon_discount_type, v_coupon_discount_value
      FROM user_coupons uc
      JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.id = v_coupon_id;

      IF v_coupon_discount_type = 'fixed' THEN
        v_coupon_discount := COALESCE(v_coupon_discount_value, 0);
      ELSIF v_coupon_discount_type = 'percentage' THEN
        v_coupon_discount := ROUND(v_total * COALESCE(v_coupon_discount_value, 0) / 100.0);
      END IF;
    END IF;
  END IF;

  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee, 0);

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, coupon_discount_amount = v_coupon_discount,
      final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points, delivery_fee = v_delivery_fee
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

-- ── 4-b) sync_order_after_composition_change ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change(p_order_id bigint)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id               UUID;
  v_grade                 TEXT;
  v_rate                  NUMERIC := 0;
  v_total                 NUMERIC := 0;
  v_discount              NUMERIC := 0;
  v_coupon_discount       NUMERIC := 0;
  v_holiday_extra_fee     NUMERIC := 0;
  v_final                 NUMERIC := 0;
  v_points                INTEGER;
  v_delivery_fee          INTEGER;
  v_canonical_code        TEXT;
  v_legacy_coupon_id      UUID;
  v_all_allow_stacking    BOOLEAN := true;
  v_all_allow_with_points BOOLEAN := true;
  v_has_coupons           BOOLEAN := false;
  v_legacy_discount_type  TEXT;
  v_legacy_discount_value NUMERIC;
  v_legacy_allow_stacking BOOLEAN := false;
  v_legacy_max_discount   NUMERIC;
  v_legacy_allow_with_points BOOLEAN := true;
BEGIN
  SELECT user_id, selected_coupon_id, selected_points, delivery_fee
  INTO   v_user_id, v_legacy_coupon_id, v_points, v_delivery_fee
  FROM   orders
  WHERE  id = p_order_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, '주문을 찾을 수 없습니다.';
    RETURN;
  END IF;

  v_points       := GREATEST(0, COALESCE(v_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(v_delivery_fee, 0));

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  SELECT rr.reservation_code INTO v_canonical_code
  FROM   order_items oi
  JOIN   rental_reservations rr ON rr.id = oi.reservation_id
  WHERE  oi.order_id = p_order_id
  ORDER  BY rr.id ASC
  LIMIT  1;

  IF v_canonical_code IS NOT NULL THEN
    UPDATE rental_reservations rr
    SET    reservation_code = v_canonical_code
    WHERE  rr.id IN (
      SELECT oi.reservation_id FROM order_items oi WHERE oi.order_id = p_order_id
    )
      AND  rr.reservation_code IS DISTINCT FROM v_canonical_code;
  END IF;

  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM   order_items oi
  WHERE  oi.order_id = p_order_id;

  SELECT COALESCE(SUM(line.holiday_extra_fee), 0)
  INTO   v_holiday_extra_fee
  FROM   order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS line
  WHERE  oi.order_id = p_order_id;

  -- 다중 쿠폰: 정액 → 정률(같은 기준 합산 · 1일차 한정은 1일차 몫) → 무료배송 (Migration 621)
  SELECT h.coupon_discount, h.all_allow_stacking, h.all_allow_with_points, h.has_coupons
  INTO   v_coupon_discount, v_all_allow_stacking, v_all_allow_with_points, v_has_coupons
  FROM   apply_order_coupon_discounts(p_order_id, v_total, order_first_day_base(p_order_id), v_delivery_fee) h;

  IF v_has_coupons THEN
    IF NOT v_all_allow_stacking THEN
      v_discount := 0;
    ELSE
      v_discount := ROUND(v_total * v_rate / 100.0);
    END IF;

    IF NOT v_all_allow_with_points THEN
      v_points := 0;
    END IF;
  ELSIF v_legacy_coupon_id IS NOT NULL THEN
    SELECT c.discount_type, c.discount_value, c.allow_stacking, c.max_discount_amount, c.allow_with_points
      INTO v_legacy_discount_type, v_legacy_discount_value, v_legacy_allow_stacking, v_legacy_max_discount, v_legacy_allow_with_points
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_legacy_coupon_id;

    IF v_legacy_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_legacy_discount_value, 0);
    ELSIF v_legacy_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_legacy_discount_value, 0) / 100.0);
      IF v_legacy_max_discount IS NOT NULL AND v_legacy_max_discount > 0 THEN
        v_coupon_discount := LEAST(v_coupon_discount, v_legacy_max_discount);
      END IF;
    ELSIF v_legacy_discount_type = 'free_shipping' THEN
      v_coupon_discount := LEAST(COALESCE(v_legacy_discount_value, 0), v_delivery_fee);
    END IF;

    IF NOT COALESCE(v_legacy_allow_with_points, true) THEN
      v_points := 0;
    END IF;

    IF NOT COALESCE(v_legacy_allow_stacking, false) THEN
      v_discount := 0;
    ELSE
      v_discount := ROUND(v_total * v_rate / 100.0);
    END IF;
  ELSE
    v_coupon_discount := 0;
    v_discount := ROUND(v_total * v_rate / 100.0);
  END IF;

  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee + v_holiday_extra_fee, 0);

  UPDATE orders
  SET    total_amount          = v_total,
         discount_amount       = v_discount,
         coupon_discount_amount = v_coupon_discount,
         holiday_extra_fee     = v_holiday_extra_fee,
         final_amount          = v_final
  WHERE  id = p_order_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$function$;

-- ── 5) 결제 전(pending) 쿠폰 주문 재계산 ──────────────────────────────────────────────
DO $resync$
DECLARE
  v_id BIGINT;
BEGIN
  FOR v_id IN
    SELECT DISTINCT o.id FROM orders o JOIN order_coupons oc ON oc.order_id = o.id WHERE o.status = 'pending'
  LOOP
    PERFORM sync_order_after_composition_change(v_id);
  END LOOP;
END
$resync$;
