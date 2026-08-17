-- Migration 281: cancel_payment_and_release_hold — 'hold' 상태 미처리 결함 수정
--
-- 배경: 상품상세 대여수량(qty) 다중예약 작업(TASK.md 2026-08-17) 도중 Stage DB
-- pg_get_functiondef로 이 함수의 실제 정의를 직접 확인한 결과, WHERE절이
-- status IN ('temp', 'pending', 'confirmed')만 매치하고 있었다 — 'temp'는
-- rental_reservations_status_check에 애초에 존재하지 않는 무효 값이고,
-- 정작 이 함수가 해제해야 할 실제 상태인 'hold'는 목록에 없었다.
--
-- 영향: 이 함수는 두 지점에서 "결제 실패 시 HOLD 예약 취소"를 위해 호출된다
--   · src/routes/api/payment/confirm/+server.ts:134 (confirm RPC 실패 시)
--   · src/routes/payment/fail/+page.server.ts:23 (토스 결제 실패 콜백)
-- 두 경우 모두 이 시점의 예약은 항상 'hold' 상태이므로, UPDATE가 매 호출마다 0행에
-- 적용됐다. 그런데도 예외 없이 jsonb_build_object('success', true)를 반환해 호출부는
-- "정상적으로 HOLD가 해제됐다"고 오인했다 — 실제로는 결제 실패 후에도 hold 예약이
-- 그대로 남아 재고를 계속 점유했을 가능성이 있다(payment.test.ts 기존 테스트는 존재하지
-- 않는 더미 reservation_id로 호출해 이 결함을 가리고 있었음 — 같은 세션에서 실제 hold
-- 픽스처로 재작성해 RED 확인 완료).
--
-- 수정 내용:
--   1. WHERE절에 'hold' 추가(핵심 수정 — 이 함수의 실사용 목적).
--   2. GET DIAGNOSTICS로 실제 갱신된 행 수를 확인해, 0행이면 success:false + 이유를
--      반환하도록 변경(update_reservation_status RPC와 동일 패턴) — 향후 같은 종류의
--      "조용한 성공 오보고"가 재발해도 즉시 드러나도록 함.
--   3. 기존 'temp'/'pending'/'confirmed'는 하위호환을 위해 그대로 유지(제거하지 않음).
--
-- 시그니처·GRANT(service_role 전용, Migration 172)는 변경하지 않는다.

CREATE OR REPLACE FUNCTION public.cancel_payment_and_release_hold(
  p_reservation_id BIGINT,
  p_user_id        UUID,
  p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_updated_count INT;
BEGIN
  UPDATE rental_reservations
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND status IN ('temp', 'pending', 'hold', 'confirmed');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '취소 가능한 예약을 찾을 수 없습니다 (이미 처리되었거나 본인 예약이 아님).'
    );
  END IF;

  UPDATE payment_transactions
  SET status = 'failed', updated_at = now()
  WHERE reservation_id = p_reservation_id
    AND status = 'pending';

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ROLLBACK (수동 실행용 — 이번 수정 이전 정의로 복원):
-- CREATE OR REPLACE FUNCTION public.cancel_payment_and_release_hold(
--   p_reservation_id BIGINT, p_user_id UUID, p_reason TEXT DEFAULT NULL
-- ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $function$
-- BEGIN
--   UPDATE rental_reservations SET status = 'cancelled', updated_at = now()
--   WHERE id = p_reservation_id AND user_id = p_user_id
--     AND status IN ('temp', 'pending', 'confirmed');
--   UPDATE payment_transactions SET status = 'failed', updated_at = now()
--   WHERE reservation_id = p_reservation_id AND status = 'pending';
--   RETURN jsonb_build_object('success', true);
-- EXCEPTION WHEN OTHERS THEN
--   RETURN jsonb_build_object('success', false, 'error', SQLERRM);
-- END; $function$;
