-- Migration 636: confirm_order_payment_and_update_reservations — 결제금액 서버 대조 (2026-10-03, CRITICAL)
--
-- 배경: 이 RPC는 p_paid_amount(호출자가 넘기는 청구금액)를 orders.final_amount와 비교하지 않아, 실제 존재하는
--   주문에 더 적은 금액을 넘겨도 payment_transactions 기록 + 예약 결제완료(payment_confirmed_at)가 그대로 일어났다
--   (Stage 라이브 테스트 payAmountServerVerification.test.ts 로 재현).
-- 변경: 정의는 Migration 378과 동일하되, 멱등 가드 이후 "실제로 존재하는 주문(p_order_id)"이면
--   p_paid_amount = orders.final_amount 를 요구한다. 불일치 시 {success:false, error:'PAID_AMOUNT_MISMATCH'}.
--   - 주문이 없는 p_order_id(기존 RPC 단위 테스트의 더미 값)는 비교 대상이 없어 기존대로 통과한다.
--   - 권한은 CREATE OR REPLACE가 보존한다(postgres, service_role만 실행 — anon/authenticated 없음). 시그니처 무변경.
--
-- ROLLBACK (필요 시 수동 실행): Migration 378(20260829050000_378_confirm_order_payment_rpc.sql)의 정의로
--   CREATE OR REPLACE 복원(본 변경의 v_order_final 선언과 "금액 대조" 블록 제거).

CREATE OR REPLACE FUNCTION public.confirm_order_payment_and_update_reservations(
  p_order_id bigint,
  p_reservation_ids bigint[],
  p_payment_key text,
  p_toss_order_id text,
  p_idempotency_key text,
  p_total_amount integer,
  p_paid_amount integer,
  p_point_amount integer DEFAULT 0,
  p_coupon_discount integer DEFAULT 0,
  p_payment_method text DEFAULT NULL::text,
  p_toss_response jsonb DEFAULT NULL::jsonb,
  p_calc_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS jsonb
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
  v_order_final                  NUMERIC;
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

  -- ── 2b. 결제금액 서버 대조 (Migration 636) ─────────────────────────────────
  -- 실제 존재하는 주문이면 청구금액은 서버에 저장된 orders.final_amount와 같아야 한다.
  IF p_order_id IS NOT NULL THEN
    SELECT final_amount INTO v_order_final FROM orders WHERE id = p_order_id;
    IF FOUND AND v_order_final IS NOT NULL AND p_paid_amount::NUMERIC IS DISTINCT FROM v_order_final THEN
      RETURN jsonb_build_object(
        'success',    false,
        'error',      'PAID_AMOUNT_MISMATCH',
        'expected',   v_order_final,
        'received',   p_paid_amount
      );
    END IF;
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
