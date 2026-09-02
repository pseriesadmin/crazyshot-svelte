-- Migration 428: set_reservation_options RPC에 서버측 재고 최종방어선 추가
-- (2026-09-03, Stephen 승인 — "옵션 상품 재고 서버측 최종방어선 지금 바로 추가 개발")
--
-- 배경: 옵션상품(reservation_options)은 메인상품(rental_reservations)과 달리 실물 재고 단위를
-- FOR UPDATE SKIP LOCKED로 원자 배정하지 않고 qty(수량)만 기록한다(rental-lifecycle.md
-- "옵션상품(reservation_options)" 참고). 이번 세션(2026-09-02)에 만든 프론트 사전차단
-- (clampToAvailableStock/stockCapFor/incrementOptionQty 등)은 브라우저 UI 가드일 뿐 —
-- ① devtools로 이 RPC를 직접 호출하면 그대로 우회되고 ② 필수 옵션의 초기 qty가 재고와 무관하게
-- 무조건 1로 세팅되던 별개 결함(products/[id]/+page.svelte, 이번 마이그레이션과 함께 수정)까지
-- 겹쳐 정상 UI 흐름만으로도 재고 초과 상태가 저장될 수 있었다(QA 지적, Stephen 확인 후 즉시 착수).
--
-- 검증 기준: get_available_stock_counts(Migration 421)와 동일한 "활성 자식 수" 개념을 쓰되,
-- 그 함수가 보지 못하는 reservation_options의 교차예약 누적 점유량까지 함께 계산한다
-- (get_available_stock_counts는 rental_reservations 기준 점유만 볼 뿐, reservation_options로
-- 소비되는 수량은 애초에 집계 대상이 아니었음 — 옵션상품은 자신이 직접 rental_reservations
-- 행을 만들지 않으므로 반드시 reservation_options.qty를 합산해야 함):
--   available = 옵션상품(부모)의 활성 자식 수
--               - SUM(다른 예약들의 reservation_options.qty), 단 그 예약 status가
--                 hold/confirmed/shipped/in_use/return_requested(비종결)인 것만 집계
--                 (draft는 메인상품도 실물 재고를 점유하지 않으므로 동일하게 제외 — 정합성 유지)
-- 자기 자신(p_reservation_id)의 기존 옵션 행은 이번 호출의 DELETE 대상이므로 점유 합산에서
-- 제외한다(재저장 시 이중 카운트 방지).
--
-- option_product_id가 NULL인 옵션(실물 상품에 연결되지 않은 순수 텍스트 옵션)은 애초에
-- 재고 추적 대상이 아니므로 검증을 건너뛴다(기존 동작 그대로 — NULL 허용은 원 스키마 설계 의도).
--
-- 검증 실패 시 RAISE EXCEPTION으로 전체 호출을 롤백한다(DELETE도 함께 롤백되어 기존 저장값이
-- 그대로 유지됨 — plpgsql 함수 1회 호출은 호출 트랜잭션 내에서 원자적으로 실행되므로 별도
-- SAVEPOINT 없이도 부분 반영 없음).

CREATE OR REPLACE FUNCTION public.set_reservation_options(p_reservation_id bigint, p_options jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_total_active INT;
  v_occupied_by_others INT;
  v_available INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rental_reservations
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status IN ('draft', 'hold')
  ) THEN
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

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    COALESCE((elem->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_reservation_options(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_reservation_options(BIGINT, JSONB) TO authenticated;
