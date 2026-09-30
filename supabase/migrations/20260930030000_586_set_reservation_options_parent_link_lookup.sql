-- Migration 586: set_reservation_options — 무료(is_free) 옵션 링크를 "본상품(부모)" 기준으로 조회
--
-- 결함(Migration 569 PRICE-FREE-1의 잔여): 예약(rental_reservations.product_id)은 항상 재고(자식)
--   id로 저장되는데(1예약=1자식), 옵션 링크(product_option_links.product_id)는 부모 상품에 저장된다.
--   569는 v_main_product_id(=자식 id)로 링크를 조회해 링크를 찾지 못했고, 그 결과 무료 옵션이어도
--   reservation_options.unit_price가 서버에서 0으로 강제되지 않고 클라이언트가 보낸 정가가 그대로 저장됐다.
--   (청구·화면 금액은 Migration 585가 이미 0으로 막아 실제 금액 피해는 없음 — 저장값 표기만 불일치)
--
-- 수정: 예약 상품을 부모로 환산(COALESCE(parent_product_id, product_id))해 링크를 조회한다.
--   Migration 585(compute_reservation_line_amount)의 본상품 해석 기준과 동일.
--   재고 가드·수량·삭제/재삽입 로직 및 시그니처·권한(ACL)은 569와 완전히 동일(무변경).
--   부모 id로 만든 예약(자식 아님)도 COALESCE 덕분에 기존과 동일하게 동작한다.
--
-- 범위: 이후 저장분부터 적용. 기존 reservation_options 행은 변경하지 않음(청구가 이미 0이고 과거 행 수정은 감사 부담).
--
-- ROLLBACK: 아래 함수를 Migration 569 본문(20260928110000_569_option_links_is_free.sql의
--   set_reservation_options 정의)으로 CREATE OR REPLACE 하면 된다(ACL 불변).

CREATE OR REPLACE FUNCTION set_reservation_options(p_reservation_id BIGINT, p_options JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_item RECORD;
  v_total_active INT;
  v_occupied_by_others INT;
  v_available INT;
  v_main_product_id UUID;
BEGIN
  -- 본상품(부모) 환산: 예약 상품이 재고(자식)면 그 부모, 아니면 자기 자신 (옵션 링크는 부모에 저장됨)
  SELECT COALESCE(p.parent_product_id, rr.product_id) INTO v_main_product_id
  FROM rental_reservations rr
  LEFT JOIN products p ON p.id = rr.product_id
  WHERE rr.id = p_reservation_id AND rr.user_id = auth.uid() AND rr.status IN ('draft', 'hold');

  IF v_main_product_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT
      NULLIF(elem->>'option_product_id', '')::UUID AS option_product_id,
      COALESCE((elem->>'qty')::INTEGER, 0) AS qty
    FROM jsonb_array_elements(p_options) AS elem
    WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0
  LOOP
    CONTINUE WHEN v_item.option_product_id IS NULL;

    SELECT COUNT(*) INTO v_total_active
    FROM products c
    WHERE c.parent_product_id = v_item.option_product_id
      AND c.is_active = true AND c.deleted_at IS NULL;

    SELECT COALESCE(SUM(ro.qty), 0) INTO v_occupied_by_others
    FROM reservation_options ro
    JOIN rental_reservations rr ON rr.id = ro.reservation_id
    WHERE ro.option_product_id = v_item.option_product_id
      AND ro.reservation_id != p_reservation_id
      AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested');

    v_available := GREATEST(0, v_total_active - v_occupied_by_others);

    IF v_item.qty > v_available THEN
      RAISE EXCEPTION 'OPTION_STOCK_EXCEEDED:%', v_item.option_product_id;
    END IF;
  END LOOP;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  -- PRICE-FREE-1: option_product_id가 이 예약의 본상품(부모, v_main_product_id) 기준
  -- product_option_links에서 is_free=true로 설정돼 있으면 unit_price를 무조건 0으로 강제한다
  -- — 클라이언트가 다른 값을 보내도 무시(과금 보안). 다른 본상품의 링크는 영향 없음.
  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_option_links pol
        WHERE pol.product_id = v_main_product_id
          AND pol.option_product_id = NULLIF(elem->>'option_product_id', '')::UUID
          AND pol.deleted_at IS NULL
          AND pol.is_free = true
      ) THEN 0
      ELSE COALESCE((elem->>'unit_price')::NUMERIC, 0)
    END
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$$;
