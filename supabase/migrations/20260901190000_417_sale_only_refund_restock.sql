-- Migration #417: 판매전용(sale_only) 상품 환불 시 재고 자동 복구
-- 배경(2026-09-01, sp3-qa-agent 검수 중 발견): Migration #416이 판매전용 상품 결제확정
--   시점에 재고(자식 유닛)를 자동으로 is_active=false 처리하도록 만들었으나, 그 반대
--   방향(전액환불/취소 시 재고를 다시 켜는 로직)이 없어 환불된 상품이 영구히 재고에서
--   빠진 채로 남는 문제가 있었다. Stephen 확정: "환불 완료 시 자동으로 재고 다시 켜기".
-- 훅 지점: cancel_reservation_payment RPC가 예약별로 update_reservation_status(id,
--   'cancelled')를 호출하는 구조이므로, 그 함수의 'cancelled' 조기분기에 판매전용 상품
--   재활성화 로직을 추가한다(원자성 보장 — 같은 함수 내 UPDATE 성공 후에만 실행,
--   EXCEPTION WHEN OTHERS로 함수 전체가 감싸여 있어 실패 시 상태변경도 함께 롤백됨).
-- 대여 상품(sale_only=false) 취소 경로는 전혀 변경하지 않는다 — 신규 분기는 조건부 추가.

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

  IF v_current_status IN ('completed', 'cancelled', 'damage_claimed') THEN
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
-- ROLLBACK (역순 실행)
-- ============================================================
-- Migration #416의 update_reservation_status CREATE OR REPLACE 문을 재실행해 복구
-- (cancelled 분기의 재고 복구 UPDATE만 제거)
-- ============================================================
