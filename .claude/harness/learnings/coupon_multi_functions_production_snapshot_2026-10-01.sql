-- Production(vnbpmvxruyciuuaermyh) use_coupons / create_reservation_order 적용 전 스냅샷 (2026-10-01, Migration 605 적용 직전)
-- 공백·주석 제거 md5: create_reservation_order = cb6d2b96f4b207494a4c96b745a07e5e, use_coupons = 2b46dfdee64568343d2bc823227020a2
-- (Stage와 동일 확인). 롤백 시 아래 정의로 CREATE OR REPLACE.
-- 신규: DROP FUNCTION IF EXISTS public.validate_order_coupons(UUID, BIGINT, UUID[]);
--       DROP FUNCTION IF EXISTS public.cms_set_allow_coupon_stacking(UUID, BOOLEAN);
--       (coupons.allow_coupon_stacking 컬럼은 CMS가 참조하지 않게 된 뒤에만 DROP)
-- ⚠️ 아래 create_reservation_order는 Migration 533 원본 + 587(PRICE-UNSET-GUARD) 상태이며
--    다중쿠폰 경로의 order_id 모호성 결함(DELETE/ON CONFLICT)을 그대로 가진 "수정 전" 정의다.

CREATE OR REPLACE FUNCTION public.use_coupons(p_user_id uuid, p_order_id bigint, p_user_coupon_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sorted_ids    UUID[];
  v_id            UUID;
  v_step_result   JSONB;
  v_results       JSONB := '[]'::jsonb;
BEGIN
  IF p_user_coupon_ids IS NULL OR array_length(p_user_coupon_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_COUPONS_SELECTED');
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_sorted_ids
  FROM unnest(p_user_coupon_ids) AS x;

  FOREACH v_id IN ARRAY v_sorted_ids LOOP
    v_step_result := private._validate_and_consume_coupon(p_user_id, p_order_id, v_id);

    IF COALESCE((v_step_result->>'ok')::boolean, false) = false THEN
      RAISE EXCEPTION 'COUPON_STACK_REJECTED:%:%', v_id, COALESCE(v_step_result->>'error', 'UNKNOWN')
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
    VALUES (p_order_id, v_id, (v_step_result->>'coupon_id')::UUID, 0)
    ON CONFLICT (order_id, user_coupon_id) DO NOTHING;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'user_coupon_id', v_id,
        'ok', true,
        'redeemed_code', v_step_result->>'redeemed_code'
      )
    );
  END LOOP;

  PERFORM sync_order_after_composition_change(p_order_id);

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$function$;

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
  v_coupon_id     UUID;
  v_points        INTEGER;
  v_delivery_fee  INTEGER;
  v_canonical_code TEXT;
  r               RECORD;
  line            RECORD;
  v_fixed_sum          NUMERIC := 0;
  v_pct_sum            NUMERIC := 0;
  v_fs_sum_raw         NUMERIC := 0;
  v_running_balance    NUMERIC := 0;
  cp                   RECORD;
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

    DELETE FROM order_coupons WHERE order_id = v_order_id;

    v_fixed_sum  := 0;
    v_pct_sum    := 0;
    v_fs_sum_raw := 0;

    FOR cp IN
      SELECT uc.id AS user_coupon_id, uc.coupon_id, c.discount_type, c.discount_value
      FROM user_coupons uc
      JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.id = ANY(p_selected_coupon_ids) AND uc.user_id = p_user_id
    LOOP
      IF cp.discount_type = 'fixed' THEN
        v_fixed_sum := v_fixed_sum + COALESCE(cp.discount_value, 0);
        INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
        VALUES (v_order_id, cp.user_coupon_id, cp.coupon_id, COALESCE(cp.discount_value, 0))
        ON CONFLICT (order_id, user_coupon_id) DO UPDATE SET discount_amount = EXCLUDED.discount_amount;
      ELSIF cp.discount_type = 'free_shipping' THEN
        v_fs_sum_raw := v_fs_sum_raw + COALESCE(cp.discount_value, 0);
        INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
        VALUES (v_order_id, cp.user_coupon_id, cp.coupon_id, COALESCE(cp.discount_value, 0))
        ON CONFLICT (order_id, user_coupon_id) DO UPDATE SET discount_amount = EXCLUDED.discount_amount;
      END IF;
    END LOOP;

    v_running_balance := GREATEST(v_total - v_fixed_sum, 0);

    FOR cp IN
      SELECT uc.id AS user_coupon_id, uc.coupon_id, c.discount_value, c.max_discount_amount
      FROM user_coupons uc
      JOIN coupons c ON c.id = uc.coupon_id
      WHERE uc.id = ANY(p_selected_coupon_ids) AND uc.user_id = p_user_id
        AND c.discount_type = 'percentage'
      ORDER BY uc.coupon_id ASC
    LOOP
      DECLARE
        v_step_discount NUMERIC;
      BEGIN
        v_step_discount := ROUND(v_running_balance * COALESCE(cp.discount_value, 0) / 100.0);
        IF cp.max_discount_amount IS NOT NULL AND cp.max_discount_amount > 0 THEN
          v_step_discount := LEAST(v_step_discount, cp.max_discount_amount);
        END IF;
        v_pct_sum := v_pct_sum + v_step_discount;
        v_running_balance := GREATEST(v_running_balance - v_step_discount, 0);
        INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
        VALUES (v_order_id, cp.user_coupon_id, cp.coupon_id, v_step_discount)
        ON CONFLICT (order_id, user_coupon_id) DO UPDATE SET discount_amount = EXCLUDED.discount_amount;
      END;
    END LOOP;

    v_coupon_discount := v_fixed_sum + v_pct_sum + LEAST(v_fs_sum_raw, v_delivery_fee);
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
