-- Migration #496: cancel_reservation_payment v2 — EC-1 / EC-2 수정
-- 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §2
--
-- EC-1 수정: 성공 경로(결제 있음)에서 취소된 예약의 contracts.status도 'cancelled'로 갱신
-- EC-2 수정: PAYMENT_NOT_FOUND 경로에서 order_items 경유 형제 예약 전체를 cancelled로 처리
--            (이전에는 아무것도 하지 않고 즉시 반환했음)
--
-- EC-3 경계: order_items 없는 단건 예약(linkToOrder 미호출) → 자기 자신만 cancelled
--            계약(contracts)은 성공 경로에서만 업데이트 → EC-3 contract.status='active' 유지
--
-- 테스트: src/__tests__/services/updateStatusOrderWideCancel.test.ts
--   EC-1: 두 confirmed 예약 + 공통 결제 → cancel_reservation_payment 호출 후
--         양쪽 contracts.status = 'cancelled' (FAIL → GREEN)
--   EC-2: 두 hold 예약(결제 없음) + 주문 연결 → 양쪽 예약 'cancelled' (FAIL → GREEN)
--   EC-3: 한 hold 예약 + 계약(주문 연결 없음) → contract.status 'active' 유지 (이미 PASS)

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

  -- ── EC-2 fix: 결제 없는 경우 → 형제 예약(또는 자신)을 모두 취소 후 PAYMENT_NOT_FOUND 반환 ──
  -- 이전: 아무것도 하지 않고 즉시 {success:false, error:'PAYMENT_NOT_FOUND'} 반환
  -- 이후: order_items 경유로 같은 주문의 예약을 전부 cancelled로 처리 후 반환
  IF v_payment_id IS NULL THEN
    SELECT oi.order_id INTO v_order_id_int
    FROM order_items oi
    WHERE oi.reservation_id = p_reservation_id
    LIMIT 1;

    IF v_order_id_int IS NOT NULL THEN
      SELECT ARRAY_AGG(reservation_id ORDER BY reservation_id)
      INTO v_all_reservation_ids
      FROM order_items
      WHERE order_id = v_order_id_int;
    ELSE
      -- order_items 없는 단건 예약(EC-3 케이스) — 자기 자신만 취소
      v_all_reservation_ids := ARRAY[p_reservation_id];
    END IF;

    FOREACH v_rid IN ARRAY v_all_reservation_ids LOOP
      SELECT status INTO v_current_status
      FROM rental_reservations
      WHERE id = v_rid;
      IF v_current_status IS NOT NULL AND v_current_status <> 'cancelled' THEN
        PERFORM public.update_reservation_status(v_rid, 'cancelled');
      END IF;
    END LOOP;

    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_NOT_FOUND');
  END IF;

  -- ── 3. payment_transactions 취소 처리 (전액, 단 1행) + 감사 컬럼 기록 ─────────
  UPDATE payment_transactions
  SET
    status        = 'cancelled',
    cancelled_at  = now(),
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

  -- ── EC-1 fix: 취소된 예약의 계약 상태도 cancelled로 갱신 ──────────────────────
  -- PAYMENT_NOT_FOUND 경로에서는 실행되지 않음
  -- → EC-3(order_items 없는 단건, 계약 있음)의 contract.status='active' 유지 보장
  UPDATE contracts
  SET status = 'cancelled'
  WHERE reservation_id = ANY(v_cancelled_ids)
    AND status <> 'cancelled';

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

-- 권한 재적용 (Migration 384와 동일)
REVOKE ALL ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_payment(BIGINT, UUID, TEXT)
  TO service_role;

-- ============================================================
-- ROLLBACK: 이전 버전으로 복원 시 Migration #384를 CREATE OR REPLACE로 재실행
-- ============================================================
