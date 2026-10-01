-- Migration 612 — 쿠폰 주문의존 조건(최소 대여일수·방문 전용): 구매(판매전용) 건은 판정에서 제외 (2026-10-01, Stephen 확정)
--
-- 정책:
--   · 대여+구매 혼합 주문: "최소 대여일수"·"방문 전용" 쿠폰은 대여 상품에만 해당 — 구매 건(대여일수 0·크레이지배송 고정) 때문에 거절하지 않는다.
--   · 구매 건만 있는 주문(대여 건 없음): 이 두 조건 쿠폰은 거절(MIN_DAYS_NOT_MET / WALK_IN_ONLY) — 대여 건이 없으면 집계가 NULL이라 기존 판정식이 그대로 거절한다.
--   · 최소 금액 조건은 변경 없음(주문 합계 기준).
-- 구매 건 판별: 예약의 duration_type='purchase' 또는 상품이 판매전용(자식은 부모 값) — products.md §2-15 "두 신호만 사용" 규칙.
-- 구현: private._validate_and_consume_coupon 현행 정의의 집계 쿼리 한 곳만 앵커 치환(멱등, 앵커 불일치 시 중단).
-- 클라이언트(cart/+page.svelte otConditionCtx)는 이미 구매 건을 제외하고 판정하므로 변경 없음.
DO $do$
DECLARE
  v_def TEXT;
  v_cnt INT;
  v_a TEXT := E'      FROM order_items oi\n      JOIN rental_reservations rr ON rr.id = oi.reservation_id\n      WHERE oi.order_id = p_order_id;\n\n      IF COALESCE(v_uc.min_rental_days, 0) > 0';
  v_b TEXT := E'      FROM order_items oi\n      JOIN rental_reservations rr ON rr.id = oi.reservation_id\n      JOIN products rp ON rp.id = rr.product_id\n      LEFT JOIN products rpp ON rpp.id = rp.parent_product_id\n      WHERE oi.order_id = p_order_id\n        AND rr.duration_type IS DISTINCT FROM ''purchase''\n        AND NOT COALESCE(rpp.sale_only, rp.sale_only, false);\n\n      IF COALESCE(v_uc.min_rental_days, 0) > 0';
BEGIN
  SELECT pg_get_functiondef('private._validate_and_consume_coupon(uuid,bigint,uuid)'::regprocedure) INTO v_def;
  IF position('rpp.sale_only' IN v_def) > 0 THEN RETURN; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '_validate_and_consume_coupon anchor mismatch: %', v_cnt; END IF;
  EXECUTE replace(v_def, v_a, v_b);
END
$do$;
