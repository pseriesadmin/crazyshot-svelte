-- Migration 553: 판매전용 재고 "자동 비활성" 마커 + 수동 비활성 재고 보호 (2026-09-27, 상품관리 ④)
--
-- 배경: #416/#417은 판매전용 예약 confirmed → 재고 is_active=false, cancelled → 무조건 is_active=true.
-- 결함: 관리자가 파손 등으로 수동 비활성한 재고도 그 예약 취소 때 다시 켜질 수 있었다.
-- 수정: 자동으로 끈 재고에만 마커(auto_deactivated_reservation_id = 끈 예약 id)를 남기고,
--       취소 시 "그 예약이 자동으로 끈 재고"만 복원한다. 수동 비활성·타 예약이 끈 재고는 유지.
-- 적용 순서: Stage(ezyvffjvuwmtuhpxdjrw) 검증 → Production(vnbpmvxruyciuuaermyh).
-- 시그니처 무변경이라 CREATE OR REPLACE(ACL 보존). 본문은 #487 기반, 변경은 두 곳(a·b)뿐.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS auto_deactivated_reservation_id BIGINT NULL
  REFERENCES public.rental_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_auto_deactivated_reservation
  ON public.products (auto_deactivated_reservation_id)
  WHERE auto_deactivated_reservation_id IS NOT NULL;

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

    -- (b) #553: 이 예약이 자동으로 끈 재고만 복원(마커 일치). 수동 비활성·타 예약이 끈 재고는 유지.
    IF p_new_status = 'cancelled' AND v_product_id IS NOT NULL THEN
      SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
      IF v_is_sale THEN
        UPDATE products
           SET is_active = true, auto_deactivated_reservation_id = NULL
         WHERE id = v_product_id
           AND auto_deactivated_reservation_id = p_reservation_id;
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

  -- (a) #553: 켜져 있던 재고만 자동 비활성 + 마커 기록(이미 수동 비활성이면 마커 NULL 유지)
  IF p_new_status = 'confirmed' AND v_product_id IS NOT NULL THEN
    SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
    IF v_is_sale THEN
      UPDATE products
         SET is_active = false, auto_deactivated_reservation_id = p_reservation_id
       WHERE id = v_product_id AND is_active = true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================
-- ROLLBACK (초안)
-- ============================================================
-- 1) 20260910090000_487_update_reservation_status_expired_terminal.sql 의 CREATE OR REPLACE 블록 재실행
-- 2) DROP INDEX IF EXISTS public.idx_products_auto_deactivated_reservation;
--    ALTER TABLE public.products DROP COLUMN IF EXISTS auto_deactivated_reservation_id;
-- ============================================================
