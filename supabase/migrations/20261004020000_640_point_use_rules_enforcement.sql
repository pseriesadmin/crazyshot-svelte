-- Migration #640: 포인트 사용 규칙을 주문 생성·동기화 함수에서 서버 강제 + use_points 주문 한도 (2026-10-04, CRITICAL)
--
-- 배경: 포인트(selected_points)는 0 이상이기만 하면 저장돼 잔액·결제금액을 넘을 수 있었고, 쿠폰이 포인트 사용을
--   막아도 final_amount에서만 0 취급되고 저장값은 그대로였다. Migration #639의 normalize_point_use가 정본 규칙이다.
-- 변경(정의는 Migration 626과 동일, 아래 3곳만 추가 — 쿠폰·1일차·연장요금 산식 무변경):
--   1) create_reservation_order: v_final 계산 직전에 v_points := normalize_point_use(...)
--   2) sync_order_after_composition_change: 같은 보정 + 보정된 값을 orders.selected_points에도 저장
--   3) use_points: p_order_id가 있으면 orders.selected_points 초과 차감을 거부(POINTS_EXCEED_ORDER)
--
-- ROLLBACK (필요 시 수동 실행): create_reservation_order·sync_order_after_composition_change는 Migration 626
--   (20261002090000_626_holiday_fee_in_total_base.sql)의 정의로, use_points는 Migration 498의 정의로 CREATE OR REPLACE 복원
--   (626 끝의 $resync$ 블록은 데이터 재계산이므로 복원 시 불필요).

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
  v_holiday_extra_fee NUMERIC := 0;
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

  -- 휴무일 연장요금도 "총 기본 대여요금(T)"에 합산한다 — 멤버십·쿠폰 할인 대상 포함 (Migration 626, Stephen 확정)
  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM order_items oi WHERE oi.order_id = v_order_id;

  -- ⚠️ 별칭은 plpgsql 변수 line(RECORD)과 충돌하지 않게 lf를 쓴다(ambiguous column 방지)
  SELECT COALESCE(SUM(lf.holiday_extra_fee), 0) INTO v_holiday_extra_fee
  FROM order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS lf
  WHERE oi.order_id = v_order_id AND oi.reservation_id IS NOT NULL;

  v_total := v_total + v_holiday_extra_fee;

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

  -- 포인트 사용 규칙 서버 강제 (Migration #640): 잔액·결제금액·CMS 설정(ON/OFF·최소·단위·최대 비율)으로 보정
  v_points := public.normalize_point_use(p_user_id, v_points, v_total - v_discount - v_coupon_discount + v_delivery_fee);
  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee, 0);

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, coupon_discount_amount = v_coupon_discount,
      holiday_extra_fee = v_holiday_extra_fee, final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points, delivery_fee = v_delivery_fee
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

-- sync_order_after_composition_change ──────────────────────────────────────────
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

  SELECT COALESCE(SUM(line.holiday_extra_fee), 0)
  INTO   v_holiday_extra_fee
  FROM   order_items oi
  CROSS JOIN LATERAL compute_reservation_line_amount(oi.reservation_id) AS line
  WHERE  oi.order_id = p_order_id;

  -- 총 기본 대여요금(T) = 상품·옵션 요금(연장일 차감 후) + 휴무일 연장요금 — 할인 대상 포함 (Migration 626)
  SELECT COALESCE(SUM(oi.line_total), 0) + v_holiday_extra_fee INTO v_total
  FROM   order_items oi
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

  -- 포인트 사용 규칙 서버 강제 (Migration #640): 잔액·결제금액·CMS 설정(ON/OFF·최소·단위·최대 비율)으로 보정
  -- 단, 이미 포인트가 차감된(use_points 기록이 있는) 주문은 재계산해도 저장된 포인트를 유지한다 —
  -- 차감 뒤에는 잔액이 줄어 있어 보정하면 결제 완료된 주문의 청구액이 사후에 바뀌기 때문.
  IF NOT EXISTS (
    SELECT 1 FROM point_transactions pt
    WHERE pt.type = 'use' AND pt.ref_type = 'order' AND pt.ref_id = p_order_id::text
  ) THEN
    v_points := public.normalize_point_use(v_user_id, v_points, v_total - v_discount - v_coupon_discount + v_delivery_fee);
  END IF;
  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee, 0);

  UPDATE orders
  SET    total_amount          = v_total,
         discount_amount       = v_discount,
         coupon_discount_amount = v_coupon_discount,
         holiday_extra_fee     = v_holiday_extra_fee,
         final_amount          = v_final,
         selected_points       = v_points
  WHERE  id = p_order_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$function$;


-- use_points: 주문에 저장된 selected_points를 넘는 차감 거부 (Migration 498 정의 + 주문 한도)
CREATE OR REPLACE FUNCTION public.use_points(
  p_user_id UUID,
  p_points  INTEGER,
  p_order_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining INTEGER;
  v_order_points INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'deducted', 0);
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT selected_points INTO v_order_points FROM public.orders WHERE id = p_order_id;
    IF FOUND AND p_points > COALESCE(v_order_points, 0) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'POINTS_EXCEED_ORDER');
    END IF;
  END IF;

  UPDATE public.user_profiles
  SET points = points - p_points,
      updated_at = now()
  WHERE id = p_user_id
    AND points >= p_points
  RETURNING points INTO v_remaining;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_POINTS');
  END IF;

  INSERT INTO public.point_transactions(user_id, type, amount, balance_after, description, ref_type, ref_id)
  VALUES (
    p_user_id, 'use', -p_points, v_remaining,
    '예약 결제 시 포인트 사용',
    CASE WHEN p_order_id IS NOT NULL THEN 'order' ELSE NULL END,
    CASE WHEN p_order_id IS NOT NULL THEN p_order_id::text ELSE NULL END
  );

  RETURN jsonb_build_object('ok', true, 'deducted', p_points, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) TO service_role;
