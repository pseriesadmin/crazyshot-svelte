-- Migration 378 — confirm_order_payment_and_update_reservations (2026-08-29)
-- TossPayments v2 실연동: 주문(order) 단위 그룹 결제 확정 RPC
--
-- 핵심 설계:
--   - 주문 1건 = Toss 결제 1회 → payment_transactions 1행(대표 reservation 연결)
--   - 나머지 예약(형제)은 mark_reservation_payment_confirmed 루프로 §9 게이팅 통과
--   - 기존 confirm_payment_and_update_reservation(단일 예약용) 시그니처 불변 유지 (삭제 금지)
--
-- plan_source: /Users/stevenmac/.claude/plans/cart-cms-reservation-status-selected-30-merry-fiddle.md Phase 2-1

CREATE OR REPLACE FUNCTION public.confirm_order_payment_and_update_reservations(
  p_order_id          BIGINT,
  p_reservation_ids   BIGINT[],
  p_payment_key       TEXT,
  p_toss_order_id     TEXT,
  p_idempotency_key   TEXT,
  p_total_amount      INT,
  p_paid_amount       INT,
  p_point_amount      INT DEFAULT 0,
  p_coupon_discount   INT DEFAULT 0,
  p_payment_method    TEXT DEFAULT NULL,
  p_toss_response     JSONB DEFAULT NULL,
  p_calc_at           TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id                   UUID;
  v_existing_id                  UUID;
  v_representative_reservation   BIGINT;
  v_user_id                      UUID;
  v_rid                          BIGINT;
BEGIN
  -- ── 1. 멱등 가드 ──────────────────────────────────────────────────────────
  -- idempotency_key 또는 toss_order_id(payment_transactions.order_id)로 기존 행 존재 시 반환
  SELECT id INTO v_existing_id
  FROM payment_transactions
  WHERE idempotency_key = p_idempotency_key
     OR order_id        = p_toss_order_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',    true,
      'payment_id', v_existing_id,
      'idempotent', true
    );
  END IF;

  -- ── 2. 파라미터 검증 ──────────────────────────────────────────────────────
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'RESERVATION_IDS_REQUIRED');
  END IF;

  -- ── 3. 대표 예약 & user_id 조회 ──────────────────────────────────────────
  v_representative_reservation := p_reservation_ids[1];

  SELECT user_id INTO v_user_id
  FROM rental_reservations
  WHERE id = v_representative_reservation;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RESERVATION_NOT_FOUND');
  END IF;

  -- ── 4. payment_transactions 1행 INSERT (주문당 1행) ───────────────────────
  INSERT INTO payment_transactions (
    reservation_id,
    user_id,
    payment_key,
    order_id,
    idempotency_key,
    total_amount,
    paid_amount,
    point_amount,
    coupon_discount,
    payment_method,
    status,
    toss_response,
    calc_at,
    confirmed_at
  ) VALUES (
    v_representative_reservation,
    v_user_id,
    p_payment_key,
    p_toss_order_id,
    p_idempotency_key,
    p_total_amount,
    p_paid_amount,
    p_point_amount,
    p_coupon_discount,
    p_payment_method,
    'done',
    p_toss_response,
    p_calc_at,
    now()
  )
  RETURNING id INTO v_payment_id;

  -- ── 5. 전체 예약에 대해 §9 게이팅 통과 시도 (mark_reservation_payment_confirmed 루프) ──
  FOREACH v_rid IN ARRAY p_reservation_ids LOOP
    PERFORM public.mark_reservation_payment_confirmed(v_rid);
  END LOOP;

  RETURN jsonb_build_object(
    'success',    true,
    'payment_id', v_payment_id,
    'idempotent', false
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',    false,
    'error',      SQLERRM,
    'error_code', SQLSTATE
  );
END;
$function$;

-- service_role 전용 (결제 확정은 서버사이드에서만 실행)
REVOKE ALL ON FUNCTION public.confirm_order_payment_and_update_reservations(
  BIGINT, BIGINT[], TEXT, TEXT, TEXT, INT, INT, INT, INT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_order_payment_and_update_reservations(
  BIGINT, BIGINT[], TEXT, TEXT, TEXT, INT, INT, INT, INT, TEXT, JSONB, TIMESTAMPTZ
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment_and_update_reservations(
  BIGINT, BIGINT[], TEXT, TEXT, TEXT, INT, INT, INT, INT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;
