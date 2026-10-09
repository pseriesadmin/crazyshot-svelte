-- Migration #687: 고객 취소 "요청" 표식 — 서명+결제 후 취소는 관리자 승인(환불)까지 보류 (2026-10-09, CRITICAL — Stephen 확정)
--
-- 정책: 계약완료(confirmed) 예약을 고객이 취소하면 예약·결제는 그대로 두고 "취소 요청"만 접수한다(채팅 카드 + 이 표식).
--   관리자가 CMS에서 [예약취소]를 실행하면 기존 경로(Toss 전액 환불 + cancel_reservation_payment)로 주문 전체가 취소·환불된다.
--   표식은 "취소대기" 배지·마이페이지 "취소중" 표시의 기준이다(status가 cancelled가 되면 자동으로 대기 종료).
-- 기존 customer_cancelled_at / cancel_confirmed_at(#589, 이미 취소·환불된 건의 관리자 확인용)은 그대로 둔다.
--
-- RPC(H-01, service_role 전용): request_customer_cancel(bigint[]) — 계약완료이고 아직 요청 표식이 없는 예약에만 기록(멱등).
--
-- ROLLBACK: DROP FUNCTION public.request_customer_cancel(bigint[]);
--   DROP INDEX public.idx_rental_reservations_cancel_requested;
--   ALTER TABLE public.rental_reservations DROP COLUMN cancel_requested_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_rental_reservations_cancel_requested
  ON public.rental_reservations (id)
  WHERE cancel_requested_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_customer_cancel(p_reservation_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE rental_reservations
     SET cancel_requested_at = now()
   WHERE id = ANY(p_reservation_ids)
     AND status = 'confirmed'
     AND cancel_requested_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.request_customer_cancel(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_customer_cancel(bigint[]) TO service_role;
