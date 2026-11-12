-- Migration 810: 파트너 예약취소를 DB 한 번에(원자적으로) 처리 — 결제 전 신청대기만, 확인과 취소 사이 경합 차단 (2026-11-11, Stephen 지시·sp5 권고)
--
-- 배경: 파트너(정책: 예약변경 및 취소 ON 계정)는 환불·계약 취소 없이 '상태만' 취소하는 경로를 쓴다. 이전에는 서버 코드가 먼저 예약 상태를 읽어 검사한 뒤
--   update_reservation_status 를 따로 호출했다 — 그 사이 고객이 결제를 끝내면 "결제됐는데 환불 없이 취소"가 될 수 있었다(검사와 취소가 한 묶음이 아님, sp5 MINOR-4).
--   update_reservation_status 자체는 결제 여부·호출자 역할을 보지 않는다(기존 설계 — 매니저 경로는 환불 RPC가 따로 처리).
--
-- 내용: cancel_unpaid_reservations_for_partner(대표 예약 id, 같은 주문 예약 id 배열)
--   1) 대상 예약 행을 id 순으로 잠근다(FOR UPDATE) — 같은 행을 바꾸는 결제 확정·다른 취소와 순서가 갈린다.
--   2) 잠근 상태에서 검사한다. 하나라도 어긋나면 아무것도 바꾸지 않고 NOT_ALLOWED 를 돌려준다.
--      · 상태가 pending·hold 가 아니다(이미 취소·만료된 형제는 건너뜀, 그 외는 거절)
--      · payment_confirmed_at 이 채워져 있다
--      · 결제 거래(payment_transactions)가 있고 취소(환불)되지 않았다 — 예약 id 로도, 주문의 주문키(orders.order_key = payment_transactions.order_id)로도 찾는다
--   3) 통과하면 같은 거래 안에서 update_reservation_status(…,'cancelled') 를 대표 예약부터 호출한다. 대표 예약 처리 실패는 전체 롤백, 형제의 이미 종료된 건은 건너뛴다.
--   4) 서버 전용 — service_role 만 실행(REVOKE ALL FROM PUBLIC, anon, authenticated).
--
-- 한계(문서화): 토스가 결제를 승인했는데 우리 DB 반영(confirm_order_payment_and_update_reservations)이 실패한 사고 상황은 DB 에 결제 흔적이 남지 않아 이 함수로도 알 수 없다 — 앱의 결제 결과 처리 쪽 표식이 필요한 별도 과제.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- 롤백(별도 마이그레이션): DROP FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]);

CREATE OR REPLACE FUNCTION public.cancel_unpaid_reservations_for_partner(
  p_primary_id bigint,
  p_reservation_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids    bigint[];
  v_row    record;
  v_res    jsonb;
  v_rid    bigint;
BEGIN
  IF p_primary_id IS NULL OR p_reservation_ids IS NULL OR cardinality(p_reservation_ids) = 0
     OR NOT (p_primary_id = ANY (p_reservation_ids)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'error', '잘못된 요청입니다.');
  END IF;

  -- 1) 행 잠금(id 순) — 결제 확정·다른 취소와 같은 행을 동시에 바꾸지 못하게 한다
  SELECT array_agg(id ORDER BY id)
    INTO v_ids
    FROM (
      SELECT id FROM rental_reservations
       WHERE id = ANY (p_reservation_ids)
       ORDER BY id
       FOR UPDATE
    ) locked;

  IF v_ids IS NULL OR NOT (p_primary_id = ANY (v_ids)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', '예약을 찾을 수 없습니다.');
  END IF;

  -- 2) 잠근 상태에서 검사 — 하나라도 어긋나면 아무것도 바꾸지 않는다
  FOR v_row IN
    SELECT id, status, payment_confirmed_at FROM rental_reservations WHERE id = ANY (v_ids)
  LOOP
    IF v_row.status IN ('cancelled', 'expired') AND v_row.id <> p_primary_id THEN
      CONTINUE; -- 이미 종료된 형제는 건너뜀(기존 동작과 같음)
    END IF;
    IF v_row.status NOT IN ('pending', 'hold') OR v_row.payment_confirmed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
        'error', '결제가 끝났거나 계약완료 이후인 예약은 매니저 이상만 취소(환불 포함)할 수 있습니다.');
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM payment_transactions pt
     WHERE pt.status IS DISTINCT FROM 'cancelled'
       AND (
         pt.reservation_id = ANY (v_ids)
         OR pt.order_id IN (
           SELECT o.order_key
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE oi.reservation_id = ANY (v_ids)
              AND o.order_key IS NOT NULL
         )
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'error', '결제가 끝났거나 계약완료 이후인 예약은 매니저 이상만 취소(환불 포함)할 수 있습니다.');
  END IF;

  -- 3) 취소 — 대표 예약 먼저, 실패하면 전체 롤백(예외로 되돌림)
  v_res := public.update_reservation_status(p_primary_id, 'cancelled');
  IF COALESCE((v_res ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PRIMARY_CANCEL_FAILED: %', COALESCE(v_res ->> 'error', '예약 취소 처리 실패');
  END IF;

  FOREACH v_rid IN ARRAY v_ids LOOP
    CONTINUE WHEN v_rid = p_primary_id;
    -- 형제 중 이미 종료된 건은 update_reservation_status 가 ok=false 로 돌려주며 건너뛴다(기존 동작)
    PERFORM public.update_reservation_status(v_rid, 'cancelled');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cancelled_ids', to_jsonb(v_ids));

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FAILED', 'error', regexp_replace(SQLERRM, '^PRIMARY_CANCEL_FAILED: ', ''));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) TO service_role;

COMMENT ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) IS
  '파트너 예약취소 — 행 잠금 후 결제 전 pending·hold(결제 흔적 없음)만 원자적으로 취소. 서버(service_role) 전용. Migration 810.';
