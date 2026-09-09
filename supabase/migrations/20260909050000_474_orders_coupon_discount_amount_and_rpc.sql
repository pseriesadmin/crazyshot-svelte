-- Migration 474: orders.coupon_discount_amount 컬럼 + create_reservation_order RPC 쿠폰반영
--
-- ⚠️ 이 마이그레이션은 "신규 변경"이 아니라 **이미 Stage(ezyvffjvuwmtuhpxdjrw)에 직접 SQL로
-- 적용돼 정상 동작 중인 변경사항을 뒤늦게 재현 가능한 파일로 캡처**하는 것이다(2026-09-09,
-- 이 세션 앞선 단계에서 create_reservation_order 재작성 + 컬럼 추가를 Supabase MCP로 직접
-- 적용했으나 당시 대응 마이그레이션 파일을 작성하지 않은 공백을 sp3-qa-agent 검수로 발견).
-- 아래 내용은 Stage DB의 실제 함수 정의(pg_get_functiondef)와 컬럼 정의(information_schema)를
-- 그대로 옮긴 것 — Stage에 이미 적용돼 있으므로 이 파일을 Stage에 다시 적용해도 결과는
-- 동일(멱등)하다. 목적은 이 변경을 재현 가능하게 만들어 향후 Production 적용 시 참조할
-- 소스를 코드베이스에 남기는 것.
--
-- 배경: create_reservation_order가 회원등급 할인만 계산·저장하고 쿠폰 할인은
-- orders.selected_coupon_id에 캐싱만 할 뿐 final_amount 산식에 전혀 반영하지 않던 설계
-- 결함(Migration #400 버전까지의 상태) — 전자계약에는 쿠폰 할인 항목이 표시되는데 정작
-- 결제 검증(pay-result)·고객 서명 화면(final_amount 참조)은 쿠폰이 적용 안 된 금액을
-- 그대로 쓰는 내부 불일치였다. Stephen 지적("합산 요금 출처는 시스템에서 가져와야지 전자계약
-- 자체에서 계산식을 돌리면 안 된다")에 따라 쿠폰 할인 계산을 이 RPC 단일 지점으로 통합했다.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount_amount numeric NOT NULL DEFAULT 0;

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

  -- 2026-09-09(Stephen 지시) — 쿠폰 할인을 실제 청구금액(final_amount)에 반영.
  -- cart/+page.svelte otCouponDiscount·contract-data/+server.ts
  -- resolveSelectedCouponDiscountAmount()와 동일한 3-way 산식(fixed/percentage/그외=0)을
  -- 이 시스템 단일 소스(order 생성 시점)에서 재사용 — 화면(장바구니 미리보기·계약서)은
  -- 더 이상 이 금액을 자체적으로 재계산하지 않고 orders.coupon_discount_amount를 그대로 읽는다.
  v_coupon_discount := 0;
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

  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee, 0);

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, coupon_discount_amount = v_coupon_discount,
      final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points, delivery_fee = v_delivery_fee
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;
