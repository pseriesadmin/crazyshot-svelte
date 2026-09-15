-- Migration 497: sync_order_after_composition_change RPC + CMS 재고구성 버그 2종 수정
--
-- 배경:
--   CMS RentalDetailPanel "재고구성" 탭에서 '+ 추가'/'✕ 삭제' 실행 후 발생하는 버그 2종:
--   ① cms_add_reservation_product_unit 이 raw 24h price 를 그대로 order_items.line_total에
--     넣는다 — 12h 블록 요금·옵션요금을 무시해 실제 청구금액과 다른 line_total이 저장됨.
--   ② 추가·삭제 후 orders.total_amount / final_amount 가 재계산되지 않아 주문 합계가 틀림.
--   ③ 추가 후 형제 rental_reservations.reservation_code 가 canonical(MIN id) 코드로
--     동기화되지 않아 예약코드 불일치.
--
-- 해결 설계:
--   새 RPC sync_order_after_composition_change(p_order_id BIGINT):
--     (1) canonical code sync — order에 연결된 형제 중 MIN(id) reservation의 코드로 통일
--     (2) amount recalc — total / discount(회원등급) / coupon_discount / final 전부 재계산
--         (orders.selected_coupon_id·selected_points·delivery_fee 읽어서 Migration 474 동일 산식)
--
--   이 RPC를 단일 소스로 쓰도록:
--     - cms_add_reservation_product_unit  → compute_reservation_line_amount 로 line_total 산출 후
--                                           sync 호출
--     - cms_remove_reservation_product_unit → order_item 삭제 후 sync 호출
--     - create_reservation_order           → 기존 인라인 recalc 블록을 sync 호출로 교체
--
-- 보안:
--   모든 신규·수정 함수: SECURITY DEFINER + service_role 전용
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 연관 마이그레이션:
--   428: cms_add/remove_reservation_product_unit 원본 (이 파일이 두 함수를 수정)
--   445: compute_reservation_line_amount (line_total 산출에 사용)
--   474: create_reservation_order 원본 (이 파일이 인라인 recalc 블록을 sync로 교체)
--
-- TDD: src/__tests__/services/syncOrderAfterCompositionChange.test.ts

-- ═══════════════════════════════════════════════════════════════════
-- 1. sync_order_after_composition_change
--    재고구성 변경 후 주문 동기화 단일 진입점.
--    (canonical code sync) + (amount recalculation)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_order_after_composition_change(
  p_order_id BIGINT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id               UUID;
  v_grade                 TEXT;
  v_rate                  NUMERIC := 0;
  v_total                 NUMERIC := 0;
  v_discount              NUMERIC := 0;
  v_coupon_discount       NUMERIC := 0;
  v_coupon_discount_type  TEXT;
  v_coupon_discount_value NUMERIC;
  v_final                 NUMERIC := 0;
  v_coupon_id             UUID;
  v_points                INTEGER;
  v_delivery_fee          INTEGER;
  v_canonical_code        TEXT;
BEGIN
  -- 주문 기본 정보 + 적용된 쿠폰·포인트·배송료 읽기
  SELECT user_id, selected_coupon_id, selected_points, delivery_fee
  INTO   v_user_id, v_coupon_id, v_points, v_delivery_fee
  FROM   orders
  WHERE  id = p_order_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, '주문을 찾을 수 없습니다.';
    RETURN;
  END IF;

  v_points       := GREATEST(0, COALESCE(v_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(v_delivery_fee, 0));

  -- 회원등급 할인율
  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  -- Step 1: canonical reservation_code 동기화
  -- order에 연결된 예약 중 id가 가장 작은(가장 먼저 생성된) 예약의 코드로 통일
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

  -- Step 2: 주문 금액 재계산
  -- order_items 없는 주문(아이템 전부 삭제됐거나 아직 없음) → total=0 no-op(에러 아님)
  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM   order_items oi
  WHERE  oi.order_id = p_order_id;

  v_discount := ROUND(v_total * v_rate / 100.0);

  -- 쿠폰 할인 계산 (Migration 474의 create_reservation_order와 동일 산식)
  v_coupon_discount := 0;
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.discount_type, c.discount_value
      INTO v_coupon_discount_type, v_coupon_discount_value
    FROM   user_coupons uc
    JOIN   coupons c ON c.id = uc.coupon_id
    WHERE  uc.id = v_coupon_id;

    IF v_coupon_discount_type = 'fixed' THEN
      v_coupon_discount := COALESCE(v_coupon_discount_value, 0);
    ELSIF v_coupon_discount_type = 'percentage' THEN
      v_coupon_discount := ROUND(v_total * COALESCE(v_coupon_discount_value, 0) / 100.0);
    END IF;
  END IF;

  v_final := GREATEST(v_total - v_discount - v_coupon_discount - v_points + v_delivery_fee, 0);

  UPDATE orders
  SET    total_amount          = v_total,
         discount_amount       = v_discount,
         coupon_discount_amount = v_coupon_discount,
         final_amount          = v_final
  WHERE  id = p_order_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_after_composition_change(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_order_after_composition_change(BIGINT) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 2. cms_add_reservation_product_unit (Migration 428 수정판)
--    변경점:
--      ① order_items.line_total 산출을 raw 24h price → compute_reservation_line_amount 로 교체
--      ② order_items INSERT 후 sync_order_after_composition_change 호출
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_add_reservation_product_unit(
  p_reservation_id BIGINT,
  p_product_id     UUID
)
RETURNS TABLE(success BOOLEAN, new_reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status        TEXT;
  v_paid_at       TIMESTAMPTZ;
  v_user_id       UUID;
  v_start_date    DATE;
  v_end_date      DATE;
  v_pickup_method TEXT;
  v_return_method TEXT;
  v_duration_type TEXT;
  v_unit_id       UUID;
  v_new_res_id    BIGINT;
  v_order_id      BIGINT;
  v_unit_price    NUMERIC;
  v_line_total    NUMERIC;
BEGIN
  -- 공통 게이트: 대상 예약 재검증 (status='hold' AND payment_confirmed_at IS NULL)
  SELECT status, payment_confirmed_at, user_id, start_date, end_date,
         pickup_method, return_method, duration_type
  INTO   v_status, v_paid_at, v_user_id, v_start_date, v_end_date,
         v_pickup_method, v_return_method, v_duration_type
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '원본 예약에 대여 기간 정보가 없습니다.'; RETURN;
  END IF;

  -- 가용 재고 원자 배정 (create_hold_reservation과 동일한 FOR UPDATE SKIP LOCKED 패턴)
  SELECT p.id INTO v_unit_id
  FROM   products p
  WHERE  p.parent_product_id = p_product_id
    AND  p.deleted_at IS NULL
    AND  p.is_active = true
    AND  NOT EXISTS (
      SELECT 1
      FROM   rental_reservations rr
      WHERE  rr.product_id = p.id
        AND  rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND  daterange(rr.start_date, rr.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
  ORDER  BY p.created_at
  LIMIT  1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.'; RETURN;
  END IF;

  -- 신규 rental_reservations INSERT (reservation_code는 트리거 자동 생성)
  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method, duration_type
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    v_start_date, v_end_date,
    v_pickup_method, v_return_method, v_duration_type
  )
  RETURNING id INTO v_new_res_id;

  -- order_items 동기화 (체크아웃 완료된 예약이면 동일 order에 추가)
  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    -- compute_reservation_line_amount 로 실제 요금 산출 (12h 블록 + 옵션요금 반영)
    SELECT rental_fee, rental_fee + options_fee
    INTO   v_unit_price, v_line_total
    FROM   compute_reservation_line_amount(v_new_res_id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, v_new_res_id, v_unit_id, 1,
            COALESCE(v_unit_price, 0), COALESCE(v_line_total, 0));

    -- 주문 합계 + canonical code 동기화
    PERFORM sync_order_after_composition_change(v_order_id);
  END IF;

  RETURN QUERY SELECT true, v_new_res_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 3. cms_remove_reservation_product_unit (Migration 428 수정판)
--    변경점:
--      ① 소프트 취소 후 sync_order_after_composition_change 호출
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_remove_reservation_product_unit(
  p_target_reservation_id BIGINT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status        TEXT;
  v_paid_at       TIMESTAMPTZ;
  v_order_id      BIGINT;
  v_sibling_count INT;
BEGIN
  -- 공통 게이트: 대상 행 자체의 status/payment_confirmed_at 재검증
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = p_target_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  -- order_items 기준 형제 상품 잔존 여부 확인
  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_target_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sibling_count
    FROM   order_items
    WHERE  order_id = v_order_id
      AND  reservation_id <> p_target_reservation_id;

    IF v_sibling_count = 0 THEN
      RETURN QUERY SELECT false, '예약에 남은 상품이 없어 삭제할 수 없습니다. 예약 자체를 취소해주세요.'; RETURN;
    END IF;

    -- 대응 order_items 행 삭제 (집계 오염 방지)
    DELETE FROM order_items WHERE reservation_id = p_target_reservation_id;
  END IF;

  -- 소프트 취소 (하드 DELETE 금지 — 감사 이력 보존)
  UPDATE rental_reservations
  SET    status = 'cancelled'
  WHERE  id = p_target_reservation_id;

  -- 주문 합계 + canonical code 동기화 (order와 연결된 예약이었을 때만)
  IF v_order_id IS NOT NULL THEN
    PERFORM sync_order_after_composition_change(v_order_id);
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 4. create_reservation_order (Migration 474 수정판)
--    변경점:
--      ① 인라인 canonical code sync 블록 제거 (sync RPC로 위임)
--      ② 인라인 amount recalc 블록 제거 (sync RPC로 위임)
--      ③ order_items INSERT 후:
--         (a) UPDATE orders SET selected_coupon_id / selected_points / delivery_fee
--         (b) PERFORM sync_order_after_composition_change(v_order_id)
--         (c) SELECT final_amount INTO v_final FROM orders
--    제거된 DECLARE 변수: v_grade, v_rate, v_total, v_discount, v_coupon_discount,
--                         v_coupon_discount_type, v_coupon_discount_value, v_canonical_code
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id            UUID,
  p_reservation_ids    BIGINT[],
  p_selected_coupon_id UUID    DEFAULT NULL,
  p_selected_points    INTEGER DEFAULT 0,
  p_delivery_fee       INTEGER DEFAULT 0
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id     BIGINT;
  v_order_key    TEXT;
  v_final        NUMERIC := 0;
  v_count        INT;
  v_seq          INT;
  v_today        TEXT;
  v_coupon_id    UUID;
  v_points       INTEGER;
  v_delivery_fee INTEGER;
  r              RECORD;
  line           RECORD;
BEGIN
  IF p_user_id IS NULL OR p_reservation_ids IS NULL
     OR array_length(p_reservation_ids, 1) IS NULL THEN
    RAISE EXCEPTION '주문을 생성할 예약이 없습니다.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM   rental_reservations
  WHERE  id = ANY(p_reservation_ids)
    AND  user_id = p_user_id
    AND  status = 'hold';

  IF v_count IS DISTINCT FROM array_length(p_reservation_ids, 1) THEN
    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  -- 쿠폰 소유권 검증 (소유자가 아니면 NULL 처리)
  v_coupon_id := p_selected_coupon_id;
  IF v_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_coupons WHERE id = v_coupon_id AND user_id = p_user_id
  ) THEN
    v_coupon_id := NULL;
  END IF;

  v_points       := GREATEST(0, COALESCE(p_selected_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(p_delivery_fee, 0));

  -- 기존 주문 재사용 여부 확인
  SELECT o.id INTO v_order_id
  FROM   order_items oi
  JOIN   orders o ON o.id = oi.order_id
  WHERE  oi.reservation_id = ANY(p_reservation_ids)
  ORDER  BY o.created_at ASC
  LIMIT  1;

  IF v_order_id IS NULL THEN
    v_today := TO_CHAR(NOW(), 'YYYYMMDD');
    INSERT INTO order_key_sequences (seq_date, next_seq)
    VALUES (v_today, 2)
    ON CONFLICT (seq_date) DO UPDATE
      SET next_seq = order_key_sequences.next_seq + 1
    RETURNING order_key_sequences.next_seq - 1 INTO v_seq;

    IF v_seq IS NULL THEN v_seq := 1; END IF;

    v_order_key := 'ORD-' || v_today || '-' || LPAD(v_seq::TEXT, 5, '0');

    INSERT INTO orders (order_key, user_id, total_amount, discount_amount, tax_amount, final_amount, status)
    VALUES (v_order_key, p_user_id, 0, 0, 0, 0, 'pending')
    RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_key INTO v_order_key FROM orders o WHERE o.id = v_order_id;
  END IF;

  -- order_items 삽입 (아직 연결되지 않은 예약만, compute_reservation_line_amount 기준)
  FOR r IN
    SELECT rr.id, rr.product_id
    FROM   rental_reservations rr
    WHERE  rr.id = ANY(p_reservation_ids)
      AND  NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, r.id, r.product_id, 1,
            line.rental_fee, line.rental_fee + line.options_fee);
  END LOOP;

  -- 쿠폰·포인트·배송료를 orders에 먼저 기록한 뒤 sync 호출
  -- (sync_order_after_composition_change 가 이 값들을 orders 테이블에서 읽어 사용)
  UPDATE orders
  SET    selected_coupon_id = v_coupon_id,
         selected_points    = v_points,
         delivery_fee       = v_delivery_fee
  WHERE  id = v_order_id;

  -- canonical code sync + 전체 금액 재계산 (단일 소스)
  PERFORM sync_order_after_composition_change(v_order_id);

  -- 반환용 final_amount 읽기
  SELECT o.final_amount INTO v_final FROM orders o WHERE o.id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;
-- create_reservation_order 는 Migration 474 이전부터 권한 부여가 별도 파일(#400 등)에
-- 있으므로 이 파일에서는 REVOKE/GRANT 를 재설정하지 않는다 — 기존 ACL 그대로 유지.

-- ═══════════════════════════════════════════════════════════════════
-- 적용 후 확인 쿼리 (Stage 검증 시 사용)
-- SELECT proname, proacl FROM pg_proc
--   WHERE proname = 'sync_order_after_composition_change';
-- → proacl에 service_role=X 만 보이고 public/anon/authenticated 미포함 확인
--
-- SELECT proname FROM pg_proc
--   WHERE proname IN (
--     'sync_order_after_composition_change',
--     'cms_add_reservation_product_unit',
--     'cms_remove_reservation_product_unit',
--     'create_reservation_order'
--   );
-- ═══════════════════════════════════════════════════════════════════
