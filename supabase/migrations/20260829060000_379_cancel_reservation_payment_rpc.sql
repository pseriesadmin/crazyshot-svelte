-- Migration 379 — cancel_reservation_payment (2026-08-29, 수정 2026-08-29)
-- CMS 환불용 RPC: Toss 실취소는 앱 서버에서 선행 호출 후 이 RPC로 DB만 갱신
--
-- 핵심 설계 (Stephen 확정 — "주문 전체 전액환불"):
--   - HTTP 호출 없음 (DB 갱신만 담당)
--   - 대표 예약 직접 매칭 OR order_items 경유 그룹 내 결제 행 탐색 (결제 행 조회 방식 유지)
--   - 취소는 같은 order에 속한 전체 예약 목록을 대상으로 한다
--     (단, order_items 행이 없는 단일 예약은 p_reservation_id 자신만 취소 — 하위호환)
--   - 이미 cancelled인 예약은 스킵 (멱등)
--   - AUTO_NOTIFY 연동: update_reservation_status('cancelled') → reservation_cancelled 채팅카드 자동 발송
--   - 응답에 cancelled_reservation_ids(취소된 전체 예약 id 배열) 포함
--
-- plan_source: /Users/stevenmac/.claude/plans/cart-cms-reservation-status-selected-30-merry-fiddle.md Phase 2-2

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
  -- ── 1. payment_transactions 행 조회 ──────────────────────────────────────
  -- 1a. 직접 매칭: 이 예약이 대표 예약인 경우
  SELECT id, payment_key, order_id
  INTO v_payment_id, v_payment_key, v_toss_order_id
  FROM payment_transactions
  WHERE reservation_id = p_reservation_id
    AND status = 'done'
  LIMIT 1;

  -- 1b. order_items 경유: 이 예약이 형제 예약인 경우
  --     같은 주문(order_id BIGINT)에 속한 예약 중 payment_transactions 대표 행 탐색
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

  -- ── 2. 결제 행 없음 에러 ──────────────────────────────────────────────────
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_NOT_FOUND');
  END IF;

  -- ── 3. payment_transactions 취소 처리 (전액, 단 1행) ─────────────────────
  UPDATE payment_transactions
  SET
    status       = 'cancelled',
    cancelled_at = now()
  WHERE id = v_payment_id;

  -- ── 4. 이 주문에 속한 모든 reservation_id 수집 ───────────────────────────
  -- order_items를 통해 같은 주문 전체 예약 목록 조회
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

  -- ── 5. 전체 예약 → cancelled (이미 cancelled는 스킵, 멱등) ────────────────
  -- AUTO_NOTIFY: update_reservation_status('cancelled') → reservation_cancelled 채팅카드 자동 발송
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

-- service_role 전용 (환불은 CMS 서버사이드에서만)
REVOKE ALL ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  TO service_role;
