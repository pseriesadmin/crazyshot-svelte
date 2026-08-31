-- Migration 384 — payment_transactions 환불 감사 컬럼 추가 (2026-08-30)
-- 목적: 환불 시 사유(cancel_reason)·처리자(cancelled_by)를 payment_transactions에 기록
--       (별도 로그 테이블 신설 없이 기존 테이블에 컬럼 추가 — 가볍고 직접적)
-- QA 지적: cancel_reservation_payment RPC가 p_admin_id/p_cancel_reason을 받지만 저장 안 함 (감사추적 없음)

-- ── 1. payment_transactions 컬럼 추가 (이미 있으면 무시) ───────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. cancel_reservation_payment 재정의 — 취소 시 컬럼 기록 ──────────────────
CREATE OR REPLACE FUNCTION public.cancel_reservation_payment(
  p_reservation_id  BIGINT,
  p_admin_id        UUID,
  p_cancel_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id          UUID;
  v_payment_key         TEXT;
  v_toss_order_id       TEXT;
  v_order_id_int        BIGINT;
  v_all_reservation_ids BIGINT[];
  v_cancelled_ids       BIGINT[];
  v_rid                 BIGINT;
  v_current_status      TEXT;
BEGIN
  -- ── 1. payment_transactions 행 조회 ──────────────────────────────────────────
  -- 1a. 직접 매칭: 이 예약이 대표 예약인 경우
  SELECT id, payment_key, order_id
  INTO v_payment_id, v_payment_key, v_toss_order_id
  FROM payment_transactions
  WHERE reservation_id = p_reservation_id
    AND status = 'done'
  LIMIT 1;

  -- 1b. order_items 경유: 이 예약이 형제 예약인 경우
  IF v_payment_id IS NULL THEN
    SELECT pt.id, pt.payment_key, pt.order_id
    INTO v_payment_id, v_payment_key, v_toss_order_id
    FROM order_items oi_target
    JOIN order_items oi_any
      ON oi_any.order_id = oi_target.order_id
    JOIN payment_transactions pt
      ON pt.reservation_id = oi_any.reservation_id
    WHERE oi_target.reservation_id = p_reservation_id
      AND pt.status = 'done'
    LIMIT 1;
  END IF;

  -- ── 2. 결제 행 없음 에러 ──────────────────────────────────────────────────────
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_NOT_FOUND');
  END IF;

  -- ── 3. payment_transactions 취소 처리 (전액, 단 1행) + 감사 컬럼 기록 ─────────
  UPDATE payment_transactions
  SET
    status       = 'cancelled',
    cancelled_at = now(),
    cancel_reason = p_cancel_reason,
    cancelled_by  = p_admin_id
  WHERE id = v_payment_id;

  -- ── 4. 이 주문에 속한 모든 reservation_id 수집 ───────────────────────────────
  SELECT oi.order_id INTO v_order_id_int
  FROM order_items oi
  WHERE oi.reservation_id = p_reservation_id
  LIMIT 1;

  IF v_order_id_int IS NOT NULL THEN
    SELECT ARRAY_AGG(reservation_id ORDER BY reservation_id)
    INTO v_all_reservation_ids
    FROM order_items
    WHERE order_id = v_order_id_int;
  END IF;

  -- order_items 없는 단일 예약(레거시/카트 미거친 경로) — p_reservation_id만 취소
  IF v_all_reservation_ids IS NULL OR array_length(v_all_reservation_ids, 1) = 0 THEN
    v_all_reservation_ids := ARRAY[p_reservation_id];
  END IF;

  -- ── 5. 전체 예약 → cancelled (이미 cancelled는 스킵, 멱등) ────────────────────
  v_cancelled_ids := ARRAY[]::BIGINT[];

  FOREACH v_rid IN ARRAY v_all_reservation_ids LOOP
    SELECT status INTO v_current_status
    FROM rental_reservations
    WHERE id = v_rid;

    IF v_current_status IS NOT NULL AND v_current_status <> 'cancelled' THEN
      PERFORM public.update_reservation_status(v_rid, 'cancelled');
      v_cancelled_ids := v_cancelled_ids || v_rid;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success',                   true,
    'payment_id',                v_payment_id,
    'payment_key',               v_payment_key,
    'toss_order_id',             v_toss_order_id,
    'cancelled_reservation_ids', v_cancelled_ids
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',    false,
    'error',      SQLERRM,
    'error_code', SQLSTATE
  );
END;
$function$;

-- 권한 재적용
REVOKE ALL ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  TO service_role;
