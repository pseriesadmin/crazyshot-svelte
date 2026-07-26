-- Migration 154: log_rental_action RPC — visit_pickup 전환 상태 수정
--   변경 전: visit_pickup → 'shipped'  (반출중)
--   변경 후: visit_pickup → 'in_use'   (대여중)
--   사유: 방문 수령은 어드민이 현장에서 직접 확인 후 처리하므로
--         반출 단계를 거치지 않고 바로 대여 중으로 전환함.
--         crazy_delivery_pickup·visit_return·crazy_delivery_return 매핑은 유지.

CREATE OR REPLACE FUNCTION public.log_rental_action(
  p_reservation_id BIGINT,
  p_action_type    TEXT,
  p_admin_id       UUID,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current    TEXT;
  v_new_status TEXT;
BEGIN
  SELECT status::TEXT INTO v_current
  FROM rental_reservations
  WHERE id = p_reservation_id;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  v_new_status := CASE
    WHEN p_action_type = 'visit_pickup'          THEN 'in_use'   -- 방문 수령: 현장 확인 → 즉시 대여중
    WHEN p_action_type = 'crazy_delivery_pickup' THEN 'shipped'  -- 크레이지배송 반출: 배송 중 (고객 수령 확인 별도)
    WHEN p_action_type = 'visit_return'          THEN 'returned' -- 방문 반납: 현장 반납 → 반납완료
    WHEN p_action_type = 'crazy_delivery_return' THEN 'returned' -- 크레이지배송 반납 완료
    ELSE NULL
  END;

  INSERT INTO rental_action_logs (reservation_id, action_type, performed_by, note)
  VALUES (p_reservation_id, p_action_type, p_admin_id, p_note);

  IF v_new_status IS NOT NULL THEN
    UPDATE rental_reservations
    SET status     = v_new_status,
        updated_at = NOW()
    WHERE id = p_reservation_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',   true,
    'from', v_current,
    'to',   COALESCE(v_new_status, v_current)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_rental_action(BIGINT, TEXT, UUID, TEXT) FROM PUBLIC;
