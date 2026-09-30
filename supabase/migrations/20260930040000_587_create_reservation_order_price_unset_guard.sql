-- Migration 587: create_reservation_order — 24시간 요금 미등록 대여 상품 서버측 차단 (PRICE-UNSET-GUARD)
--
-- 결함: 24h 요금이 없는 대여 상품 차단이 장바구니 화면(priceUnsetBlocked)에만 있어,
--   /api/reservations/create-order 를 직접 호출하면 0원 주문(order_items.line_total=0)이 만들어질 수 있었다.
--   (Migration 584가 24h 없음 → 대여요금 0으로 계산하도록 정한 뒤 남은 서버 측 갭 — TASK.md 3차 QA 잔여 ①)
--
-- 수정: 주문 연결 생성 진입 직후(주문·order_items 생성 전)에 검사한다.
--   대상: 이번에 order_items가 새로 만들어질 예약(이미 order_items가 있는 예약은 멱등 재호출 보호를 위해 제외)
--   조건: 판매전용(sale_only)이 아니고, 예약 상품(재고 자식)에 활성 24h 요금(is_active, deleted_at IS NULL)이 없음
--   결과: 'PRICE_UNSET:' 예외로 전체 롤백(정상 상품이 섞여 있어도 주문·항목 미생성)
--   판정 기준은 compute_reservation_line_amount(Migration 584)의 24h 조회와 동일하다.
--
-- 그 외 로직·시그니처·권한(service_role 전용)은 무변경. 함수 본문 전체를 옮겨 적지 않고, 현재 정의에
--   가드 블록만 끼워 넣어(단일 앵커 검증) 재생성한다 — Stage·Production 정의 논리가 동일함을 사전 확인
--   (주석 제거·공백 정규화 md5 35aafc35… 일치).
--
-- ROLLBACK: 이 함수를 가드 블록(PRICE-UNSET-GUARD ... END IF;) 제거본으로 재생성한다.
--   Production 적용 직전 스냅샷: .claude/harness/learnings/create_reservation_order_production_snapshot_2026-09-30.sql

DO $mig$
DECLARE
  v_oid   oid;
  v_def   text;
  v_new   text;
  v_anchor CONSTANT text := E'  v_coupon_id := p_selected_coupon_id;\n  IF v_coupon_id IS NOT NULL AND NOT EXISTS (';
  v_guard CONSTANT text := $guard$  -- PRICE-UNSET-GUARD (Migration 587): 24h 요금 미등록 대여 상품은 주문 연결 자체를 차단
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

$guard$;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_reservation_order';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'create_reservation_order not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('PRICE-UNSET-GUARD' IN v_def) > 0 THEN
    RETURN; -- 이미 적용됨(멱등)
  END IF;

  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'create_reservation_order 앵커가 정확히 1개가 아님 — 정의가 예상과 다름, 수동 확인 필요';
  END IF;

  v_new := replace(v_def, v_anchor, v_guard || v_anchor);
  EXECUTE v_new;
END
$mig$;
