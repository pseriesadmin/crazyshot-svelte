-- Migration #798: 방문 반납 예약도 고객 반납정보 제출 시 대여중 → 반납접수(return_requested) 허용 (2026-11-06, Stephen 확정 'a: 반납접수로', sp3 BLOCKER-1 조치)
--
-- 문제: 방문 반납(return_method='visit')의 고객 제출(무인함 사진·번호·비밀번호)이 update_reservation_status(p_new_status:'return_requested')를 호출하는데,
--       #611 이후 라이브 정의는 in_use 에서 visit 에게 'returned' 만 허용해 항상 '허용되지 않은 상태 전환'으로 거절됐다(제출 행도 되돌려져 고객은 항상 실패).
-- 변경: 라이브 정의(Stage·Production md5 동일, 2026-11-06 조회)에서 전환 허용 검사 한 줄만 넓힌다 —
--       "현재 in_use + 반납 방식 visit + 요청 return_requested" 도 허용. 그 외 모든 규칙(종료상태 거절, cancelled·damage_claimed 직행, confirmed 판매 재고 처리,
--       CMS '방문 반납 처리' in_use → returned 직행)은 라이브 정의 그대로다. return_requested → returned 는 기존대로 허용된다.
-- 권한: 서버 전용(service_role) 유지 — CREATE OR REPLACE 는 권한을 유지하지만 아래에 명시적으로 다시 선언한다.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK: 아래 함수에서 "AND NOT (v_current_status = 'in_use' AND v_return_method = 'visit' AND p_new_status = 'return_requested')" 조건만 제거한 정의(#611)로 CREATE OR REPLACE.

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
  v_shortage       INT := 0;
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

    IF p_new_status = 'cancelled' THEN
      PERFORM private.restore_sale_stock_on_cancel(p_reservation_id);
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

  -- #798: 방문 반납도 고객 제출로 대여중 → 반납접수 가능(CMS 방문 반납 처리 in_use → returned 직행은 위 CASE 그대로)
  IF v_allowed_next IS NULL OR (
       p_new_status <> v_allowed_next
       AND NOT (v_current_status = 'in_use' AND v_return_method = 'visit' AND p_new_status = 'return_requested')
     ) THEN
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

  IF p_new_status = 'confirmed' THEN
    IF v_product_id IS NOT NULL THEN
      SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = v_product_id;
      IF v_is_sale THEN
        UPDATE products
           SET is_active = false, auto_deactivated_reservation_id = p_reservation_id
         WHERE id = v_product_id AND is_active = true;
      END IF;
    END IF;

    v_shortage := private.apply_sale_stock_on_confirm(p_reservation_id);
    IF v_shortage > 0 THEN
      RETURN jsonb_build_object('ok', true, 'sale_stock_shortage', v_shortage);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_reservation_status(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_status(bigint, text) TO service_role;
