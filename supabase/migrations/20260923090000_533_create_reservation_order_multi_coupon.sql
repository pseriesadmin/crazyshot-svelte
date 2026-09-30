-- Migration 533: create_reservation_order — 다중쿠폰(p_selected_coupon_ids) 지원
--   (쿠폰 다중중첩 체크아웃 구조 전환 — Phase 1 of 6)
--
-- 기존 5-param 시그니처(p_user_id, p_reservation_ids, p_selected_coupon_id,
-- p_selected_points, p_delivery_fee — Migration 474 최신본)에 p_selected_coupon_ids
-- UUID[] DEFAULT NULL을 마지막 파라미터로 추가한다.
--
-- ⛔ products.md §2-3 교훈(PGRST203 오버로드 모호성) 재발 방지 — 새 파라미터를 추가하는
-- CREATE OR REPLACE는 기존 함수를 "교체"하는 것이 아니라 별도 오버로드를 만든다
-- (Migration 340/395/400이 매번 그렇게 해왔음 — 이번에도 동일 패턴: 신규 6-param
-- CREATE + REVOKE/GRANT 후 구 5-param DROP).
--
-- 배열이 오면(p_selected_coupon_ids IS NOT NULL) 다중쿠폰 경로 — order_coupons에
-- §할인계산정책 순차 산식(fixed 합산 → percentage coupon_id 오름차순 순차적용
-- (max_discount_amount 캡) → free_shipping은 배송비 캡)으로 계산한 할인액을 upsert.
-- 배열이 NULL이면(단일값 하위호환 경로) 기존 로직 그대로 유지 — order_coupons에는
-- 손대지 않는다.
--
-- 매 호출마다 그 시점의 선택값으로 order_coupons를 완전히 교체한다(먼저 DELETE 후
-- 재INSERT) — 장바구니에서 상품을 추가로 담아 같은 주문에 재제출하며 쿠폰 선택을
-- 바꾸는 경우를 정확히 반영하기 위함.

CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id             UUID,
  p_reservation_ids     BIGINT[],
  p_selected_coupon_id  UUID DEFAULT NULL,
  p_selected_points     INTEGER DEFAULT 0,
  p_delivery_fee        INTEGER DEFAULT 0,
  p_selected_coupon_ids UUID[] DEFAULT NULL
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
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
  -- ↓ 다중쿠폰 경로 전용
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

  -- 단일값 경로(하위호환) — 배열이 오면 이 값은 orders.selected_coupon_id 갱신에만 쓰이지
  -- 않고 NULL로 취급된다(아래 분기 참고). 배열이 NULL이면 기존 로직 그대로.
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
    -- ── 다중쿠폰 경로 ──────────────────────────────────────────────────────
    -- 단일값 컬럼은 다중 선택을 표현할 수 없으므로 이 경로에서는 사용하지 않는다.
    v_coupon_id := NULL;

    -- 이번 제출값으로 이 주문의 쿠폰 선택 내역을 완전히 교체
    DELETE FROM order_coupons WHERE order_id = v_order_id;

    v_fixed_sum  := 0;
    v_pct_sum    := 0;
    v_fs_sum_raw := 0;

    -- fixed / free_shipping 합계 + 각 행 insert (본인 소유 쿠폰만, 나머지는 조용히 무시)
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

    -- percentage 쿠폰 순차 적용(coupon_id 오름차순, max_discount_amount 캡)
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
    -- ── 단일값 하위호환 경로 — Migration 474 로직 그대로 ──────────────────────
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

REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER, UUID[])
  TO service_role;

-- 구 5-param 오버로드 제거(오버로드 모호성 방지 — products.md §2-3 교훈)
DROP FUNCTION IF EXISTS public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 1. Migration 474의 CREATE OR REPLACE FUNCTION public.create_reservation_order
--    (5-param) 블록을 재실행.
-- 2. REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
--    GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER) TO service_role;
-- 3. DROP FUNCTION IF EXISTS public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER, UUID[]);
-- ============================================================
