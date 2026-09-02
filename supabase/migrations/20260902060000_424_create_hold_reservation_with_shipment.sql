-- Migration 424: create_hold_reservation_with_shipment RPC
-- 카트 수량(+) 버튼 RPC 왕복 횟수 절감 (2026-09-02, Stephen 승인 — "2번(RPC 호출 횟수 자체 줄이기)")
--
-- 배경: cart/+page.svelte의 incrementGroupQty(hold 그룹)가 create_hold_reservation →
-- set_reservation_shipment_method → set_reservation_duration 3개 RPC를 순차로 왕복 호출한다.
-- 이 함수는 세 단계를 하나의 서버 왕복으로 묶어 지연을 줄인다 — 기존 3개 RPC 자체는 그대로
-- 두고(다른 호출부 무영향), 그 조합만 한 번에 실행하는 신규 래퍼다.
--
-- 실패 처리는 기존 앱단 로직(incrementGroupQty)과 동일하게 유지한다:
--   ① create_hold_reservation 실패 → 그대로 실패 반환(생성된 것 없음)
--   ② set_reservation_shipment_method 실패 → 방금 만든 hold를 취소(status='cancelled')하고
--      실패 반환(기존 cancelUnit(newId) 호출과 동일한 결과)
--   ③ set_reservation_duration 실패 → 비차단(기존과 동일) — hold는 그대로 유지, success=true +
--      error_message에 'DURATION_SAVE_FAILED:' 접두사로 원인을 실어 반환(호출측이 비차단
--      경고 토스트만 띄우도록 구분)

CREATE OR REPLACE FUNCTION public.create_hold_reservation_with_shipment(
  p_product_id     UUID,
  p_start_date     DATE,
  p_end_date       DATE,
  p_pickup_method  TEXT,
  p_return_method  TEXT DEFAULT NULL,
  p_pickup_time    TEXT DEFAULT NULL,
  p_return_time    TEXT DEFAULT NULL,
  p_duration_type  TEXT DEFAULT '24h'
)
RETURNS TABLE(
  success         BOOLEAN,
  reservation_id  BIGINT,
  error_message   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hold RECORD;
BEGIN
  SELECT * INTO v_hold FROM create_hold_reservation(p_product_id, p_start_date, p_end_date);

  IF NOT v_hold.success THEN
    RETURN QUERY SELECT false, NULL::BIGINT, v_hold.error_message;
    RETURN;
  END IF;

  BEGIN
    PERFORM set_reservation_shipment_method(
      v_hold.reservation_id, p_pickup_method, p_return_method, p_pickup_time, p_return_time
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE rental_reservations SET status = 'cancelled' WHERE id = v_hold.reservation_id;
    RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
    RETURN;
  END;

  IF p_duration_type IS NOT NULL THEN
    BEGIN
      PERFORM set_reservation_duration(v_hold.reservation_id, p_duration_type);
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT true, v_hold.reservation_id, 'DURATION_SAVE_FAILED:' || SQLERRM;
      RETURN;
    END;
  END IF;

  RETURN QUERY SELECT true, v_hold.reservation_id, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_hold_reservation_with_shipment(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hold_reservation_with_shipment(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
