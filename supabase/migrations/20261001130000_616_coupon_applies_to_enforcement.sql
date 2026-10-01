-- Migration 616 — 쿠폰 "적용 대상"(대여/판매, Migration 615) 서버 소진 검증 (2026-10-01, Stephen 지시)
--
-- 정책: 한쪽 전용 쿠폰(applies_to_rental 또는 applies_to_sale 중 하나만 true)은 그 쿠폰이 적용되는 종류의 상품이
-- 주문에 하나라도 있어야 사용할 수 있다. 대여 전용 쿠폰 + 판매 단독 주문, 판매 전용 쿠폰 + 대여 단독 주문은 거절(COUPON_NOT_APPLICABLE).
-- 혼합 주문은 둘 다 허용(적용되는 쪽 상품이 있으므로). 둘 다 true(기본값·기존 쿠폰 전부)는 이 검사를 통과 — 기존 동작 무영향.
-- 주문 정보 없이는(p_order_id NULL) 한쪽 전용 쿠폰을 판정할 수 없어 ORDER_CONTEXT_REQUIRED.
-- 구매 판별은 products.md §2-15 "두 신호만 사용" — 예약 duration_type='purchase' 또는 상품이 판매전용(자식은 부모 값 우선).
-- 적용 범위: private._validate_and_consume_coupon 한 곳(use_coupon·use_coupons·validate_order_coupons가 모두 이 함수를 경유 — 화면·서버 일치).
-- 미결 항목(구현하지 않음): 혼합 주문에서 한쪽 전용 쿠폰의 할인 금액 범위(대여 금액에만?) · 무료배송 쿠폰 대상 · 최소 금액 기준 금액 — Stephen 결정 대기.
DO $do$
DECLARE
  v_def TEXT;
  v_cnt INT;
  v_decl_a TEXT := E'  v_used_count_by_user INT;\nBEGIN';
  v_decl_b TEXT := E'  v_used_count_by_user INT;\n  v_has_rental   BOOLEAN;\n  v_has_sale     BOOLEAN;\nBEGIN';
  v_sel_a TEXT := E'    c.max_discount_amount\n  INTO v_uc';
  v_sel_b TEXT := E'    c.max_discount_amount,\n    c.applies_to_rental,\n    c.applies_to_sale\n  INTO v_uc';
  -- 검사 삽입 앵커는 주석이 아니라 코드(첫 주문의존 IF) — Production 정의에는 주석이 없어(Stage엔 있음) 주석 앵커는 Production에서 불일치했다. 두 환경 모두 1회.
  v_chk_a TEXT := E'  IF COALESCE(v_uc.min_purchase_amount, 0) > 0\n     OR COALESCE(v_uc.min_rental_amount, 0) > 0';
  v_chk_b TEXT := E'  -- ①-b 적용 대상(대여/판매) — CMS 쿠폰 "적용 대상"(Migration 615/616)\n  IF NOT (COALESCE(v_uc.applies_to_rental, true) AND COALESCE(v_uc.applies_to_sale, true)) THEN\n    IF p_order_id IS NULL THEN\n      RETURN jsonb_build_object(''ok'', false, ''error'', ''ORDER_CONTEXT_REQUIRED'');\n    END IF;\n    SELECT COALESCE(bool_or(NOT t.is_sale), false), COALESCE(bool_or(t.is_sale), false)\n      INTO v_has_rental, v_has_sale\n    FROM (\n      SELECT (COALESCE(rr.duration_type = ''purchase'', false) OR COALESCE(rpp.sale_only, rp.sale_only, false)) AS is_sale\n        FROM order_items oi\n        JOIN rental_reservations rr ON rr.id = oi.reservation_id\n        JOIN products rp ON rp.id = rr.product_id\n        LEFT JOIN products rpp ON rpp.id = rp.parent_product_id\n       WHERE oi.order_id = p_order_id\n    ) t;\n    IF NOT ((COALESCE(v_uc.applies_to_rental, true) AND v_has_rental)\n         OR (COALESCE(v_uc.applies_to_sale, true) AND v_has_sale)) THEN\n      RETURN jsonb_build_object(''ok'', false, ''error'', ''COUPON_NOT_APPLICABLE'');\n    END IF;\n  END IF;\n\n  IF COALESCE(v_uc.min_purchase_amount, 0) > 0\n     OR COALESCE(v_uc.min_rental_amount, 0) > 0';
BEGIN
  SELECT pg_get_functiondef('private._validate_and_consume_coupon(uuid,bigint,uuid)'::regprocedure) INTO v_def;
  IF position('COUPON_NOT_APPLICABLE' IN v_def) > 0 THEN RETURN; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_decl_a, ''))) / length(v_decl_a);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '_validate_and_consume_coupon decl anchor mismatch: %', v_cnt; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_sel_a, ''))) / length(v_sel_a);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '_validate_and_consume_coupon select anchor mismatch: %', v_cnt; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_chk_a, ''))) / length(v_chk_a);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '_validate_and_consume_coupon check anchor mismatch: %', v_cnt; END IF;
  EXECUTE replace(replace(replace(v_def, v_decl_a, v_decl_b), v_sel_a, v_sel_b), v_chk_a, v_chk_b);
END
$do$;
