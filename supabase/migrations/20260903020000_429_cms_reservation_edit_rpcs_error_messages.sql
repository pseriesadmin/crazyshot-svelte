-- Migration 429: Migration 428(cms_reservation_product_edit_rpcs) 6개 RPC의 게이트 거부 메시지를
-- 상태별로 구체화 — 로직/시그니처/반환타입은 전부 동일, RETURN QUERY의 문자열 메시지만 교체.
--
-- 배경(2026-09-03, Stephen 실사용 중 발견): 신청대기(hold) 목록의 예약을 열어 "+ 재고 추가"/
-- "재고 삭제"를 실행했는데 "이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다"
-- 경고가 떴다 — 실제로는 계약/결제가 "진행"된 게 아니라, 형제 유닛 일부는 30분 hold
-- 자동만료(service-operations.md §10)로 status='expired'였고, 앵커 예약 자신은
-- payment_confirmed_at만 먼저 설정된(§9 이중게이트 — 계약서명 대기 중) 상태였다. Stage DB
-- 실제 데이터로 재현 확인:
--   - rental_reservations 8707/8711/8712: status='expired', payment_confirmed_at=NULL
--   - rental_reservations 8735(신청대기 목록에 노출된 그 예약 자신): status='hold',
--     payment_confirmed_at IS NOT NULL(이미 결제확인됨, 계약서명만 아직)
-- 차단 자체는 두 경우 다 정상 동작(§9/§10 설계 의도 그대로)이었으나, 거부 사유를 하나의
-- 고정 문구로만 안내해 "만료"와 "결제/계약 진행"을 구분하지 못했다 — 이 마이그레이션은 그
-- 메시지만 상태별로 세분화한다(차단 여부 자체는 절대 변경하지 않음).
--
-- 새 메시지 매핑(①~⑤ 공통 게이트):
--   status IS NULL           → '예약을 찾을 수 없습니다.' (기존과 동일)
--   status = 'expired'       → '예약이 만료되어 상품 구성을 수정할 수 없습니다.' (신규 구분)
--   status = 'cancelled'     → '취소된 예약은 상품 구성을 수정할 수 없습니다.' (신규 구분)
--   status NOT IN ('hold')   → '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.' (신규 구분)
--     (위 두 상태를 제외한 나머지 — confirmed/shipped/in_use/return_requested/returned/
--      completed/damage_claimed/pending)
--   status = 'hold' AND payment_confirmed_at IS NOT NULL
--                             → '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.' (신규 구분)
-- ⑥ cms_reassign_reservation_product_code 게이트도 동일 원칙으로 'expired'/'cancelled' 분리.

-- ═══════════════════════════════════════════════════════════════════
-- ① cms_add_reservation_product_unit
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
  v_status          TEXT;
  v_paid_at         TIMESTAMPTZ;
  v_user_id         UUID;
  v_start_date      DATE;
  v_end_date        DATE;
  v_pickup_method   TEXT;
  v_return_method   TEXT;
  v_duration_type   TEXT;
  v_unit_id         UUID;
  v_new_res_id      BIGINT;
  v_order_id        BIGINT;
  v_unit_price      NUMERIC;
BEGIN
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
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약이 만료되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '취소된 예약은 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '원본 예약에 대여 기간 정보가 없습니다.'; RETURN;
  END IF;

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
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.'; RETURN;
  END IF;

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

  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    SELECT COALESCE(
      (SELECT price FROM price_rules
       WHERE  product_id = p_product_id
         AND  duration_type = '24h'
         AND  is_active = true
         AND  deleted_at IS NULL
       ORDER  BY created_at DESC
       LIMIT  1),
      0
    ) INTO v_unit_price;

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, v_new_res_id, v_unit_id, 1, v_unit_price, v_unit_price);
  END IF;

  RETURN QUERY SELECT true, v_new_res_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ② cms_remove_reservation_product_unit
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
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = p_target_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' THEN
    RETURN QUERY SELECT false, '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

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

    DELETE FROM order_items WHERE reservation_id = p_target_reservation_id;
  END IF;

  UPDATE rental_reservations
  SET    status = 'cancelled'
  WHERE  id = p_target_reservation_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ③ cms_add_reservation_option
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_add_reservation_option(
  p_reservation_id    BIGINT,
  p_option_product_id UUID,
  p_option_name       TEXT,
  p_qty               INTEGER,
  p_unit_price        NUMERIC
)
RETURNS TABLE(success BOOLEAN, option_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status    TEXT;
  v_paid_at   TIMESTAMPTZ;
  v_option_id BIGINT;
BEGIN
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약이 만료되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '취소된 예약은 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  IF p_qty <= 0 THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '수량은 1 이상이어야 합니다.'; RETURN;
  END IF;

  IF COALESCE(TRIM(p_option_name), '') = '' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '옵션상품 이름을 입력해주세요.'; RETURN;
  END IF;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  VALUES (p_reservation_id, p_option_product_id, p_option_name, p_qty, COALESCE(p_unit_price, 0))
  RETURNING id INTO v_option_id;

  RETURN QUERY SELECT true, v_option_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ④ cms_update_reservation_option_qty
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_update_reservation_option_qty(
  p_option_id BIGINT,
  p_qty       INTEGER
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation_id BIGINT;
  v_status         TEXT;
  v_paid_at        TIMESTAMPTZ;
BEGIN
  SELECT reservation_id INTO v_reservation_id
  FROM   reservation_options
  WHERE  id = p_option_id;

  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT false, '옵션상품을 찾을 수 없습니다.'; RETURN;
  END IF;

  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = v_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' THEN
    RETURN QUERY SELECT false, '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  IF p_qty <= 0 THEN
    RETURN QUERY SELECT false, '수량은 1 이상이어야 합니다.'; RETURN;
  END IF;

  UPDATE reservation_options
  SET    qty = p_qty
  WHERE  id = p_option_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ⑤ cms_delete_reservation_option
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_delete_reservation_option(
  p_option_id BIGINT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation_id BIGINT;
  v_status         TEXT;
  v_paid_at        TIMESTAMPTZ;
BEGIN
  SELECT reservation_id INTO v_reservation_id
  FROM   reservation_options
  WHERE  id = p_option_id;

  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT false, '옵션상품을 찾을 수 없습니다.'; RETURN;
  END IF;

  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = v_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' THEN
    RETURN QUERY SELECT false, '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  DELETE FROM reservation_options WHERE id = p_option_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_delete_reservation_option(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_delete_reservation_option(BIGINT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ⑥ cms_reassign_reservation_product_code
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_reassign_reservation_product_code(
  p_reservation_id BIGINT,
  p_new_unit_id    UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status           TEXT;
  v_tracking         TEXT;
  v_current_unit_id  UUID;
  v_start_date       DATE;
  v_end_date         DATE;
  v_current_parent   UUID;
  v_new_parent       UUID;
  v_available        UUID;
BEGIN
  SELECT status, tracking_number, product_id, start_date, end_date
  INTO   v_status, v_tracking, v_current_unit_id, v_start_date, v_end_date
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;

  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF NOT (v_status = 'hold' OR (v_status = 'confirmed' AND v_tracking IS NULL)) THEN
    RETURN QUERY SELECT false, '운송장 등록 후 또는 대여 진행 중인 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;

  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, '예약 기간 정보가 없어 재배정할 수 없습니다.'; RETURN;
  END IF;

  SELECT parent_product_id INTO v_current_parent FROM products WHERE id = v_current_unit_id;
  SELECT parent_product_id INTO v_new_parent     FROM products WHERE id = p_new_unit_id;

  IF v_current_parent IS NULL OR v_new_parent IS NULL THEN
    RETURN QUERY SELECT false, '상품 정보를 확인할 수 없습니다.'; RETURN;
  END IF;

  IF v_current_parent <> v_new_parent THEN
    RETURN QUERY SELECT false, '같은 상품의 다른 재고단위로만 재배정할 수 있습니다.'; RETURN;
  END IF;

  SELECT p.id INTO v_available
  FROM   products p
  WHERE  p.id = p_new_unit_id
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
  FOR UPDATE SKIP LOCKED;

  IF v_available IS NULL THEN
    RETURN QUERY SELECT false, '선택한 재고가 이미 다른 예약에 배정되었습니다.'; RETURN;
  END IF;

  UPDATE rental_reservations
  SET    product_id = p_new_unit_id
  WHERE  id = p_reservation_id;

  UPDATE order_items
  SET    product_id = p_new_unit_id
  WHERE  reservation_id = p_reservation_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) TO service_role;
