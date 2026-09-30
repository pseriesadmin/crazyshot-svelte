-- Migration 589: 고객 취소 → "취소중" 표시 + 관리자 취소확인 (customer_cancelled_at / cancel_confirmed_at)
--
-- 정책(2026-09-30, Stephen): 고객이 마이페이지에서 예약을 취소하면 카드가 목록에 남아 "취소중"(비활성·흐림)으로
--   보이고, 관리자가 CMS에서 취소를 확인하면 "취소" 배지와 함께 마이페이지 "취소" 화면으로 이동한다.
--   관리자가 직접 취소·거부한 건이나 기존(레거시) 취소 건은 customer_cancelled_at이 NULL이라 처음부터 "취소" 화면에 있다.
--
-- 컬럼: customer_cancelled_at(고객이 취소한 시각) / cancel_confirmed_at(관리자 확인 시각) / cancel_confirmed_by(확인한 관리자)
--   "취소중" = status='cancelled' AND customer_cancelled_at IS NOT NULL AND cancel_confirmed_at IS NULL
--
-- RPC(H-01 준수, service_role 전용):
--   mark_customer_cancelled(bigint[])        — 고객 취소 API가 성공 직후 호출(주문 전체 취소 시 형제 포함)
--   confirm_customer_cancel(bigint, uuid)    — CMS 관리자 취소확인. 같은 주문에서 함께 고객 취소된 형제도 함께 확인 처리(멱등)
--
-- ROLLBACK: DROP FUNCTION confirm_customer_cancel(bigint,uuid), mark_customer_cancelled(bigint[]);
--   DROP INDEX idx_rental_reservations_cancel_pending; ALTER TABLE rental_reservations DROP COLUMN customer_cancelled_at, DROP COLUMN cancel_confirmed_at, DROP COLUMN cancel_confirmed_by;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS customer_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_confirmed_by   uuid;

CREATE INDEX IF NOT EXISTS idx_rental_reservations_cancel_pending
  ON public.rental_reservations (id)
  WHERE customer_cancelled_at IS NOT NULL AND cancel_confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION public.mark_customer_cancelled(p_reservation_ids bigint[])
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
     SET customer_cancelled_at = now()
   WHERE id = ANY(p_reservation_ids)
     AND status = 'cancelled'
     AND customer_cancelled_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_customer_cancel(p_reservation_id bigint, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status    text;
  v_cancelled timestamptz;
  v_confirmed timestamptz;
  v_order_id  bigint;
  v_count     integer;
BEGIN
  SELECT status, customer_cancelled_at, cancel_confirmed_at
    INTO v_status, v_cancelled, v_confirmed
  FROM rental_reservations WHERE id = p_reservation_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_status <> 'cancelled' OR v_cancelled IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer_cancelled');
  END IF;
  IF v_confirmed IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'confirmed_count', 0);
  END IF;

  SELECT oi.order_id INTO v_order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1;

  UPDATE rental_reservations rr
     SET cancel_confirmed_at = now(),
         cancel_confirmed_by = p_admin_id
   WHERE rr.status = 'cancelled'
     AND rr.customer_cancelled_at IS NOT NULL
     AND rr.cancel_confirmed_at IS NULL
     AND (
       rr.id = p_reservation_id
       OR (v_order_id IS NOT NULL AND rr.id IN (SELECT oi2.reservation_id FROM order_items oi2 WHERE oi2.order_id = v_order_id))
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'confirmed_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_customer_cancelled(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_customer_cancel(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_customer_cancelled(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_customer_cancel(bigint, uuid) TO service_role;
