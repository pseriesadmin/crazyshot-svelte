-- Migration 397 — 계약 서명 게이팅 판정을 '예약(=주문)' 단위로 통일 (2026-08-31)
--
-- 문제(감사 에이전트 CRITICAL 발견 — 2026-08-31): 이번 세션에서 init-contract API를
-- "같은 주문에 이미 계약이 있으면 재사용"으로 바꿔 계약(contracts)이 이제 주문당 정확히
-- 1건만 존재한다(대표 예약에만 anchor). 그런데 try_confirm_reservation(Migration 284)의
-- 서명완료 판정은 여전히 `WHERE c.reservation_id = p_reservation_id`로 "그 예약 자신이
-- 직접 소유한 계약"만 확인한다 — 형제 예약(같은 주문의 다른 상품)은 계약을 직접 소유하지
-- 않으므로 실제로 주문 전체가 결제+서명 다 끝났어도 형제 예약은 영원히 hold에 갇히고,
-- 30분 HOLD 자동만료 크론(release_reservation_hold)에 의해 결제까지 끝난 예약이 만료
-- 처리될 수 있는 CRITICAL 회귀.
--
-- 추가 문제: `/api/contracts/[token]/sign`·`/api/contracts/[token]/pay-mock`은 여전히
-- 계약의 대표 예약(anchor) 하나에만 mark_reservation_payment_confirmed/
-- try_confirm_reservation을 호출한다 — 형제 예약은 애초에 재시도 대상에 포함되지 않는다.
-- (참고: confirm_order_payment_and_update_reservations(Migration 378, 실Toss결제 경로)는
-- 이미 p_reservation_ids 배열 전체를 순회하므로 이 문제가 없다 — 이번 수정과 무관.)
--
-- 수정 1: try_confirm_reservation의 서명 확인을 "직접 소유 OR order_items 경유 형제 예약이
--   소유한 계약"으로 확장 — Migration 387/379/396에서 이미 쓴 것과 동일한 패턴.
-- 수정 2: 신규 RPC try_confirm_reservation_order(p_reservation_id) — 이 예약이 속한 주문의
--   전체 예약 목록(order_items 경유, 없으면 자기 자신만)에 대해 각각
--   mark_reservation_payment_confirmed를 재호출(그 함수 자체가 payment_confirmed_at
--   NULL일 때만 갱신하는 멱등 함수라 안전)한다. sign·pay-mock 엔드포인트가 대표 예약
--   하나만 처리하던 자리에 이 함수를 대신 호출하도록 앱 코드도 함께 수정한다(별도 커밋).
--
-- 시그니처 불변 원칙: try_confirm_reservation(BIGINT)의 파라미터·반환타입은 그대로 유지
--   (CREATE OR REPLACE) — 내부 판정 조건만 확장.

CREATE OR REPLACE FUNCTION public.try_confirm_reservation(p_reservation_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status               TEXT;
  v_payment_confirmed_at TIMESTAMPTZ;
  v_signed                BOOLEAN;
  v_result                JSONB;
BEGIN
  SELECT status, payment_confirmed_at INTO v_status, v_payment_confirmed_at
  FROM public.rental_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'hold' OR v_payment_confirmed_at IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2026-08-31(Migration 397): 직접 소유한 계약뿐 아니라, 같은 주문(order_items 경유)의
  -- 다른 예약이 소유한 계약도 서명완료로 인정 — init-contract가 주문당 계약 1건만 만들도록
  -- 바뀌었기 때문(대표 예약에만 계약이 anchor되고 형제 예약은 직접 소유하지 않음).
  SELECT EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.contract_signings cs ON cs.contract_id = c.id
    WHERE cs.signed_at IS NOT NULL
      AND (
        c.reservation_id = p_reservation_id
        OR c.reservation_id IN (
             SELECT oi2.reservation_id
             FROM public.order_items oi2
             WHERE oi2.order_id = (
               SELECT oi.order_id FROM public.order_items oi
               WHERE oi.reservation_id = p_reservation_id
               LIMIT 1
             )
           )
      )
  ) INTO v_signed;

  IF NOT v_signed THEN
    RETURN FALSE;
  END IF;

  v_result := public.update_reservation_status(p_reservation_id, 'confirmed');
  RETURN COALESCE((v_result ->> 'ok')::boolean, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.try_confirm_reservation(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_confirm_reservation(BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_confirm_reservation(BIGINT) TO service_role;

-- ── 신규: 주문 전체에 대해 결제확정 게이팅을 재시도 ──────────────────────────
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

  FOREACH v_rid IN ARRAY v_ids LOOP
    v_result := public.mark_reservation_payment_confirmed(v_rid);
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
