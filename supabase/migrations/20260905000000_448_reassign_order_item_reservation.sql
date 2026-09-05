-- Migration 448: reassign_order_item_reservation
-- hold 예약 재발행(reissue) 시 order_items.reservation_id를 구 hold → 신규 hold로 갱신
-- H-01 준수 — 직접 DML 대신 이 RPC를 통해서만 order_items 재연결
--
-- 호출 위치: src/routes/api/checkout/reissue-reservation/+server.ts (service_role 전용)
-- 설계: service-operations.md §4 — order는 cart checkout 시 1회 생성, 이 RPC는 그 연결만 재지정

CREATE OR REPLACE FUNCTION public.reassign_order_item_reservation(
  p_old_reservation_id BIGINT,
  p_new_reservation_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- old = new인 경우 no-op (자기 자신 재할당)
  IF p_old_reservation_id = p_new_reservation_id THEN
    RETURN;
  END IF;

  -- order_items.reservation_id를 old → new로 갱신 (행이 없으면 no-op)
  UPDATE public.order_items
  SET reservation_id = p_new_reservation_id
  WHERE reservation_id = p_old_reservation_id;
END;
$$;

-- service_role 전용 — 클라이언트 직접 호출 금지
REVOKE ALL ON FUNCTION public.reassign_order_item_reservation(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_order_item_reservation(BIGINT, BIGINT) TO service_role;
