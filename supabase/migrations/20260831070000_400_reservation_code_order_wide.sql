-- Migration 400 — 예약코드(reservation_code)를 '예약(=주문)' 단위로 통일 (2026-08-31)
-- Stephen 확정: "장바구니에 상품이 몇 개 담기든 하나의 예약신청 실행으로 예약코드가
-- 발행된 상태를 '예약' 단위로 본다 — '예약'과 '주문'은 동일어. reservation_code 자체를
-- 주문 단위로 공유하도록 재설계."
--
-- 문제: reservation_code는 지금도 rental_reservations 행(=개별 상품) 하나당 하나씩
-- BEFORE INSERT 트리거(trg_set_reservation_code, Migration 144)로 발급된다. 장바구니에
-- 상품을 여러 개 담아 함께 체크아웃해도 각 행이 서로 다른 코드를 받아, "하나의 예약건"
-- 이라는 고객 개념과 어긋난다.
--
-- 수정: create_reservation_order RPC(장바구니 체크아웃 제출 시점, Migration 280/340/395)가
-- 예약들을 하나의 주문으로 묶을 때, 그 주문에 속한 예약 전체의 reservation_code를 대표값
-- (주문 내 가장 먼저 생성된 예약 = MIN(id)의 코드) 하나로 통일한다. 개별 상품 발급 시점
-- (BEFORE INSERT 트리거)은 그대로 두고 — 어차피 카트에 담기는 순간(hold 생성)에는 아직
-- 이 상품이 다른 상품과 함께 제출될지 알 수 없으므로, "예약신청(체크아웃 제출) 실행" 시점에
-- 사후 통일하는 것이 Stephen이 표현한 "예약신청 실행으로 예약코드가 발행 등록된 상태"와
-- 정확히 일치한다.
--
-- 부수 변경: reservation_code UNIQUE 제약 제거(같은 주문의 여러 행이 이제 의도적으로 같은
-- 값을 가짐). 코드로 특정 행 1건을 조회하던 유일한 지점(/api/cms/reservations/resolve)은
-- 별도 커밋으로 결정론적 정렬(가장 먼저 생성된 행 우선)을 추가해 대응한다.

ALTER TABLE public.rental_reservations
  DROP CONSTRAINT IF EXISTS rental_reservations_reservation_code_key;

CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id            UUID,
  p_reservation_ids    BIGINT[],
  p_selected_coupon_id UUID DEFAULT NULL,
  p_selected_points    INTEGER DEFAULT 0,
  p_delivery_fee       INTEGER DEFAULT 0
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

  -- 2026-08-31(Migration 400): 이 주문에 속한 예약 전체(신규+기존 연결분 포함)의
  -- reservation_code를 하나로 통일 — 대표값은 "이 주문에서 가장 먼저 생성된 예약(MIN id)"
  -- 의 코드. 재호출해도 항상 같은 대표값으로 수렴(멱등).
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
  v_final    := v_total - v_discount + v_delivery_fee;

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points, delivery_fee = v_delivery_fee
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER)
  TO service_role;
