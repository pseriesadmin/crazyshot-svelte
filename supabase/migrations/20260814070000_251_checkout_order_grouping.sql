-- Migration 251: 체크아웃 다건 예약 → 단일 주문(order) 그룹핑
--
-- 배경: orders/order_items 테이블은 이미 라이브 DB에 존재하고 get_rental_list RPC도 이를 조인해
-- order_id/order_key/order_amount를 CMS에 내려주고 있었지만, 실제로 두 테이블에 INSERT하는 코드가
-- 어디에도 없어 항상 NULL이었다(orders에 남아있던 5건도 전부 ORD-DUMMY-00N 시드 데이터).
-- 이 마이그레이션은 체크아웃에서 여러 rental_reservations 행을 하나의 orders 행 + N개의 order_items
-- 행으로 실제 연결하는 채번/집계 로직을 추가한다.
--
-- STEP 1: calculate_cart_total의 예약 1건당 요금계산 로직을 compute_reservation_line_amount로 추출
--         (동작 변경 없음 — create_checkout_order도 동일 로직을 재사용하기 위한 리팩터링)
-- STEP 2: calculate_cart_total을 STEP 1 헬퍼를 호출하도록 갱신 (시그니처 불변)
-- STEP 3: create_checkout_order RPC 신규 — orders 1행 + order_items N행 INSERT, service_role 전용
-- STEP 4: orders/order_items RLS 정책 추가 (현재 RLS enabled + 정책 0건 = service_role 외 완전 잠금)

-- ─────────────────────────────────────────────
-- STEP 1: compute_reservation_line_amount — 예약 1건 요금계산 헬퍼
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_reservation_line_amount(p_reservation_id BIGINT)
RETURNS TABLE(rental_fee NUMERIC, options_fee NUMERIC, deposit NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r              RECORD;
  v_daily        NUMERIC;
  v_half         NUMERIC;
  v_dep          NUMERIC;
  v_p_hour       INT;
  v_p_min        INT;
  v_r_hour       INT;
  v_r_min        INT;
  v_total_days   INT;
  v_remain_hours INT;
  v_mins         INT;
  v_fee          NUMERIC;
  v_options_fee  NUMERIC;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
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

  IF r.start_date = r.end_date THEN
    v_mins := (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
    IF v_mins <= 0 THEN
      v_fee := 0;
    ELSIF v_mins <= 720 THEN
      v_fee := v_half;
    ELSE
      v_fee := v_daily;
    END IF;
  ELSE
    v_total_days := (r.end_date - r.start_date);
    v_fee := v_total_days * v_daily;
    v_remain_hours := ((v_r_hour - v_p_hour) % 24 + 24) % 24;
    IF v_remain_hours >= 12 THEN
      v_fee := v_fee + v_half;
    END IF;
  END IF;

  SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
  INTO v_options_fee
  FROM reservation_options ro
  WHERE ro.reservation_id = p_reservation_id;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;

-- ─────────────────────────────────────────────
-- STEP 2: calculate_cart_total — 헬퍼 재사용으로 갱신 (시그니처·반환값 동일)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calculate_cart_total(p_reservation_ids bigint[])
RETURNS TABLE(subtotal numeric, discount_amount numeric, final_total numeric, deposit_required numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID := auth.uid();
  v_grade    TEXT;
  v_rate     NUMERIC := 0;
  v_subtotal NUMERIC := 0;
  v_deposit  NUMERIC := 0;
  r          RECORD;
  line       RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  FOR r IN
    SELECT rr.id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids) AND rr.user_id = v_user_id
      AND rr.start_date IS NOT NULL AND rr.end_date IS NOT NULL
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);
    v_subtotal := v_subtotal + line.rental_fee + line.options_fee;
    v_deposit  := v_deposit + line.deposit;
  END LOOP;

  RETURN QUERY SELECT
    v_subtotal,
    ROUND(v_subtotal * v_rate / 100.0),
    v_subtotal - ROUND(v_subtotal * v_rate / 100.0),
    v_deposit;
END;
$function$;

-- ─────────────────────────────────────────────
-- STEP 3: create_checkout_order — 다건 예약 → 단일 주문 그룹핑 (service_role 전용)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_user_id          UUID,
  p_reservation_ids  BIGINT[]
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grade     TEXT;
  v_rate      NUMERIC := 0;
  v_total     NUMERIC := 0;
  v_discount  NUMERIC := 0;
  v_final     NUMERIC := 0;
  v_order_id  BIGINT;
  v_order_key TEXT;
  v_count     INT;
  r           RECORD;
  line        RECORD;
BEGIN
  IF p_user_id IS NULL OR p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RAISE EXCEPTION '주문을 생성할 예약이 없습니다.';
  END IF;

  -- 소유·상태 방어적 재검증 — 호출부(confirm-mock)가 이미 동일 조건으로 필터링해 넘기지만
  -- RPC 자체도 타인 예약이나 이미 처리된 예약이 섞여 들어오는 것을 막는다.
  SELECT COUNT(*) INTO v_count
  FROM rental_reservations
  WHERE id = ANY(p_reservation_ids) AND user_id = p_user_id AND status = 'hold';

  IF v_count IS DISTINCT FROM array_length(p_reservation_ids, 1) THEN
    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = p_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  v_order_key := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
    LPAD((
      SELECT COUNT(*) + 1 FROM orders
      WHERE orders.order_key LIKE 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 5, '0');

  INSERT INTO orders (order_key, user_id, total_amount, discount_amount, tax_amount, final_amount, status)
  VALUES (v_order_key, p_user_id, 0, 0, 0, 0, 'pending')
  RETURNING id INTO v_order_id;

  FOR r IN
    SELECT id, product_id FROM rental_reservations WHERE id = ANY(p_reservation_ids)
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, r.id, r.product_id, 1, line.rental_fee, line.rental_fee + line.options_fee);

    v_total := v_total + line.rental_fee + line.options_fee;
  END LOOP;

  v_discount := ROUND(v_total * v_rate / 100.0);
  v_final    := v_total - v_discount;

  -- tax_amount는 0으로 유지 — payment_transactions에도 서버측 VAT 저장 컬럼이 없어(체크아웃
  -- 화면의 클라이언트 계산치만 존재) 이번 스코프에서 새로 만들지 않는다. 쿠폰/포인트 반영도
  -- 동일 사유로 이번 주문 그룹핑과 별개인 기존 갭이라 여기서 손대지 않는다.
  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, final_amount = v_final
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) TO service_role;

-- ─────────────────────────────────────────────
-- STEP 4: orders/order_items RLS 정책 — 현재 RLS enabled + 정책 0건(=service_role 외 완전 잠금)
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "orders: 본인 조회" ON orders;
CREATE POLICY "orders: 본인 조회" ON orders
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "orders: 관리자 전체" ON orders;
CREATE POLICY "orders: 관리자 전체" ON orders
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

DROP POLICY IF EXISTS "order_items: 본인 조회" ON order_items;
CREATE POLICY "order_items: 본인 조회" ON order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "order_items: 관리자 전체" ON order_items;
CREATE POLICY "order_items: 관리자 전체" ON order_items
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
