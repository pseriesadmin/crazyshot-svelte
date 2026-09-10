-- Migration 485: update_reservation_status에 'expired'를 종료(terminal) 상태로 추가
--
-- 배경(2026-09-10, CMS 대여현황 조건 로직 검증 중 발견) — HOLD 30분 자동만료
-- (status='expired', service-operations.md §10)는 재고가 이미 해제된 종료 상태인데,
-- 이 함수의 종료상태 가드(37행)가 'completed'/'cancelled'/'damage_claimed'만 검사하고
-- 'expired'를 빠뜨리고 있었다. 그 결과 RentalDetailPanel.svelte의 "예약 취소" 버튼이
-- (프런트 TERMINAL Set도 동일하게 'expired' 누락 — 같은 커밋에서 함께 수정) 만료된
-- 예약에도 노출됐고, 클릭하면 이 함수가 실제로 status='expired' → 'cancelled' 전환을
-- 그대로 허용해버렸다(서버단 방어가 전혀 없었음).
--
-- 이번 수정은 Migration #417(현재 정의)의 37행 IN 목록에 'expired' 한 항목만 추가한다 —
-- 그 외 로직(판매전용 재고 복구, 상태 전이 맵 등)은 전혀 건드리지 않는다.
-- 시그니처(파라미터·반환타입) 무변경이라 CREATE OR REPLACE로 충분(DROP 불필요).

CREATE OR REPLACE FUNCTION public.update_reservation_status(p_reservation_id bigint, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_pickup_method  TEXT;
  v_return_method  TEXT;
  v_product_id     UUID;
  v_allowed_next   TEXT;
  v_updated_count  INT;
  v_is_sale        BOOLEAN;
BEGIN
  SELECT status, pickup_method, return_method, product_id
    INTO v_current_status, v_pickup_method, v_return_method, v_product_id
  FROM rental_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  -- 'expired' 추가(Migration #485) — HOLD 30분 자동만료도 completed/cancelled/
  -- damage_claimed와 동일하게 더 이상 상태를 변경할 수 없는 종료 상태다.
  IF v_current_status IN ('completed', 'cancelled', 'damage_claimed', 'expired') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 종료된 예약은 상태를 변경할 수 없습니다.');
  END IF;

  IF p_new_status IN ('cancelled', 'damage_claimed') THEN
    UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
    WHERE id = p_reservation_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
    END IF;

    -- #417(2026-09-01): 판매전용(sale_only) 상품 예약이 취소(환불 포함)되면 그 재고(자식
    -- 유닛)를 다시 대여(판매) 가능 상태로 되돌린다(Stephen 확정). hold 단계에서 취소된
    -- 경우는 애초에 is_active가 꺼진 적이 없어 이 UPDATE가 안전하게 no-op된다.
    IF p_new_status = 'cancelled' AND v_product_id IS NOT NULL THEN
      SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
      IF v_is_sale THEN
        UPDATE products SET is_active = true WHERE id = v_product_id;
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true);
  END IF;

  v_allowed_next := CASE v_current_status
    WHEN 'pending'           THEN 'hold'
    WHEN 'hold'               THEN 'confirmed'
    WHEN 'confirmed'          THEN CASE WHEN v_pickup_method = 'visit' THEN 'in_use' ELSE 'shipped' END
    WHEN 'shipped'            THEN 'in_use'
    WHEN 'in_use'             THEN CASE WHEN v_return_method = 'visit' THEN 'returned' ELSE 'return_requested' END
    WHEN 'return_requested'   THEN 'returned'
    WHEN 'returned'           THEN 'completed'
    ELSE NULL
  END;

  IF v_allowed_next IS NULL OR p_new_status <> v_allowed_next THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('허용되지 않은 상태 전환입니다. (현재: %s → 요청: %s)', v_current_status, p_new_status)
    );
  END IF;

  UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
  WHERE id = p_reservation_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
  END IF;

  IF p_new_status = 'confirmed' AND v_product_id IS NOT NULL THEN
    SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
    IF v_is_sale THEN
      UPDATE products SET is_active = false WHERE id = v_product_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #417의 CREATE OR REPLACE FUNCTION 블록(12~100행)을 그대로 재실행하면
-- 37행 IN 목록에서 'expired'만 빠진 이전 정의로 복원된다.
-- ============================================================
