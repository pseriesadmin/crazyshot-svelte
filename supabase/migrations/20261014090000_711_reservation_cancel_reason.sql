-- Migration #711: 예약 취소·환불 사유 저장 — 관리자가 예약 상세에서 사유를 선택·입력(자동 저장) (2026-10-14, Stephen 지시)
--
-- 변경: ① rental_reservations.cancel_reason_code(대표 사유 6종 중 1) / cancel_reason_note(추가 입력 200자 이내)
--       ② 값 검증 CHECK(코드는 6종만, 메모는 200자 이하)
--       ③ cms_set_reservation_cancel_reason(예약, 코드, 메모) — 취소된 예약에만 저장하고 같은 주문의 취소된 형제 예약에도 같은 값을 쓴다
--          (목록은 주문 1건=1행이라 대표 행 기준으로 보여도 어느 형제로 열어도 같은 사유가 보이게). service_role 전용(서버 API만 호출).
-- 이 컬럼은 payment_transactions.cancel_reason(PG 환불 시 시스템이 남기는 사유 문구)과 별개다 — 관리자가 정리하는 "취소 사유 분류".
-- 롤백: DROP FUNCTION public.cms_set_reservation_cancel_reason(bigint,text,text);
--   ALTER TABLE public.rental_reservations DROP CONSTRAINT rental_reservations_cancel_reason_chk, DROP COLUMN cancel_reason_code, DROP COLUMN cancel_reason_note;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS cancel_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason_note TEXT;

ALTER TABLE public.rental_reservations
  ADD CONSTRAINT rental_reservations_cancel_reason_chk CHECK (
    (cancel_reason_code IS NULL OR cancel_reason_code IN
      ('customer_change_mind', 'schedule_change', 'stock_issue', 'no_response', 'duplicate_error', 'other'))
    AND (cancel_reason_note IS NULL OR char_length(cancel_reason_note) <= 200)
  );

COMMENT ON COLUMN public.rental_reservations.cancel_reason_code IS '관리자가 분류한 취소·환불 사유 코드(6종) — 예약 상세 패널에서 자동 저장';
COMMENT ON COLUMN public.rental_reservations.cancel_reason_note IS '취소·환불 사유 추가 입력(200자 이내)';

CREATE OR REPLACE FUNCTION public.cms_set_reservation_cancel_reason(
  p_reservation_id BIGINT,
  p_code           TEXT,
  p_note           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status TEXT;
  v_order  BIGINT;
  v_note   TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_code   TEXT := NULLIF(btrim(COALESCE(p_code, '')), '');
  v_ids    BIGINT[];
BEGIN
  IF v_code IS NOT NULL AND v_code NOT IN
     ('customer_change_mind', 'schedule_change', 'stock_issue', 'no_response', 'duplicate_error', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;

  SELECT status INTO v_status FROM rental_reservations WHERE id = p_reservation_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancelled');
  END IF;

  SELECT order_id INTO v_order FROM order_items WHERE reservation_id = p_reservation_id LIMIT 1;
  IF v_order IS NULL THEN
    v_ids := ARRAY[p_reservation_id];
  ELSE
    SELECT COALESCE(array_agg(oi.reservation_id), ARRAY[p_reservation_id]) INTO v_ids
    FROM order_items oi
    JOIN rental_reservations rr ON rr.id = oi.reservation_id
    WHERE oi.order_id = v_order AND rr.status = 'cancelled';
  END IF;

  UPDATE rental_reservations
     SET cancel_reason_code = v_code, cancel_reason_note = v_note
   WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('ok', true, 'updated', COALESCE(array_length(v_ids, 1), 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_set_reservation_cancel_reason(bigint, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_set_reservation_cancel_reason(bigint, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_set_reservation_cancel_reason(bigint, text, text) TO service_role;
