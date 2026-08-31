-- Migration 403 — clear_reservation_tracking_number RPC 신설 (2026-08-31)
-- 목적: RSV-B-C4(GATE B Q3 (a) 확정) — 두발히어로 배송 취소 성공 후
--       rental_reservations.tracking_number를 NULL로 초기화해 "미접수" 상태로 완전히 되돌린다.
--       재접수 가능 상태를 보장하고, RSV-B-C3 멱등성 가드(POST dhero)가 재접수를 허용하도록 함.
--       취소 이력 추적은 log_rental_action으로 별도 커버됨.
--
-- 호출 위치: src/routes/api/cms/reservations/[id]/dhero/cancel/+server.ts
--            cancelDelivery() 성공 직후 fail-soft로 호출
--
-- SECURITY DEFINER + service_role 전용 (CMS 서버에서만 호출)

CREATE OR REPLACE FUNCTION public.clear_reservation_tracking_number(
  p_reservation_id BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.rental_reservations
  SET tracking_number = NULL
  WHERE id = p_reservation_id;
END;
$$;

-- service_role 전용 권한 설정
REVOKE ALL ON FUNCTION public.clear_reservation_tracking_number(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_reservation_tracking_number(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_reservation_tracking_number(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_reservation_tracking_number(BIGINT) TO service_role;
