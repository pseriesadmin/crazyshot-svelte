-- Migration 398 — try_confirm_reservation_order가 결제를 조작하던 위험한 결함 즉시 수정
-- (2026-08-31, Migration 397 적용 직후 TDD로 발견)
--
-- 문제: Migration 397에서 만든 try_confirm_reservation_order(p_reservation_id)가 주문의
-- 형제 예약들을 순회하며 mark_reservation_payment_confirmed(sibling)를 호출했다. 그런데
-- mark_reservation_payment_confirmed는 이름 그대로 "결제가 이미 확인된 예약에" 호출해야
-- 하는 함수로, payment_confirmed_at이 NULL이면 **무조건 NOW()로 채워버리는** 부수효과가
-- 있다(Migration 284 원본). 이 RPC를 /api/contracts/[token]/sign에서 "서명 후 게이팅
-- 재확인" 용도로 호출하면, 결제를 전혀 하지 않은 예약도 서명만으로 payment_confirmed_at이
-- 채워져 즉시 confirmed로 전환되는 CRITICAL 결함이 발생한다(TDD 테스트 EC-1이 즉시 재현 —
-- "결제 전 서명만 완료" 시나리오가 confirmed로 잘못 전환됨).
--
-- 수정: 용도를 완전히 분리한다.
--   1. try_confirm_reservation_order(p_reservation_id) — 결제 여부를 건드리지 않고 순수
--      게이팅 재확인만 수행(주문 전체를 순회하며 try_confirm_reservation만 호출). 서명
--      직후처럼 "결제는 이미 됐을 수도 안 됐을 수도 있으니 그냥 재확인만" 하는 용도.
--      (/api/contracts/[token]/sign이 사용)
--   2. mark_reservation_payment_confirmed_order(p_reservation_id) — 신규. 실제로 결제가
--      막 확인된 시점에 주문 전체(형제 포함)에 결제확인을 기록 + 게이팅 재확인까지 수행.
--      (/api/contracts/[token]/pay-mock이 사용 — 이 엔드포인트 자체가 "지금 이 순간
--      결제(mock)가 확정됐다"는 의미이므로 payment_confirmed_at을 기록하는 것이 맞음)

CREATE OR REPLACE FUNCTION public.try_confirm_reservation_order(p_reservation_id BIGINT)
RETURNS BIGINT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id   BIGINT;
  v_ids        BIGINT[];
  v_confirmed  BIGINT[] := ARRAY[]::BIGINT[];
  v_rid        BIGINT;
  v_result     BOOLEAN;
BEGIN
  SELECT oi.order_id INTO v_order_id
  FROM public.order_items oi
  WHERE oi.reservation_id = p_reservation_id
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    SELECT ARRAY_AGG(reservation_id ORDER BY reservation_id)
    INTO v_ids
    FROM public.order_items
    WHERE order_id = v_order_id;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    v_ids := ARRAY[p_reservation_id];
  END IF;

  -- ⚠️ 결제 여부는 절대 건드리지 않는다 — payment_confirmed_at이 이미 채워진 예약만
  -- try_confirm_reservation(순수 재확인, 부수효과 없음)으로 게이팅을 재시도한다.
  FOREACH v_rid IN ARRAY v_ids LOOP
    v_result := public.try_confirm_reservation(v_rid);
    IF v_result THEN
      v_confirmed := v_confirmed || v_rid;
    END IF;
  END LOOP;

  RETURN v_confirmed;
END;
$function$;

REVOKE ALL ON FUNCTION public.try_confirm_reservation_order(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_confirm_reservation_order(BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_confirm_reservation_order(BIGINT) TO service_role;

-- ── 신규: 결제 확정 시점 전용 — 주문 전체에 결제확인 기록 + 게이팅 재확인 ──────────
CREATE OR REPLACE FUNCTION public.mark_reservation_payment_confirmed_order(p_reservation_id BIGINT)
RETURNS BIGINT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id   BIGINT;
  v_ids        BIGINT[];
  v_confirmed  BIGINT[] := ARRAY[]::BIGINT[];
  v_rid        BIGINT;
  v_result     BOOLEAN;
BEGIN
  SELECT oi.order_id INTO v_order_id
  FROM public.order_items oi
  WHERE oi.reservation_id = p_reservation_id
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    SELECT ARRAY_AGG(reservation_id ORDER BY reservation_id)
    INTO v_ids
    FROM public.order_items
    WHERE order_id = v_order_id;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    v_ids := ARRAY[p_reservation_id];
  END IF;

  FOREACH v_rid IN ARRAY v_ids LOOP
    v_result := public.mark_reservation_payment_confirmed(v_rid);
    IF v_result THEN
      v_confirmed := v_confirmed || v_rid;
    END IF;
  END LOOP;

  RETURN v_confirmed;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_reservation_payment_confirmed_order(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_reservation_payment_confirmed_order(BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reservation_payment_confirmed_order(BIGINT) TO service_role;
