-- Migration 187: update_reservation_status 상태전환 검증 강화
-- 배경: 코드 리뷰 결과 두 가지 문제 확인 (Stephen 2026-08-05 승인 — 둘 다 고치기)
--   1) 존재하지 않는 reservation_id에도 UPDATE 0건이 적용된 채 {ok:true}를 반환 (가짜 성공)
--   2) p_new_status가 현재 상태에서 합법적인 다음 단계인지 전혀 검증하지 않음 —
--      화면의 nextStatus() 로직에만 의존하고 있어 지연 제출·중복 클릭 등으로
--      중간 단계를 건너뛴 상태 전이가 가능했음
--
-- 정책 (src/lib/utils/rentalTransition.ts nextStatus() 정본과 동일하게 서버에서도 재검증):
--   pending          → hold
--   hold             → confirmed
--   confirmed        → (pickup_method='visit' ? in_use : shipped)
--   shipped          → in_use
--   in_use           → (return_method='visit' ? returned : return_requested)
--   return_requested → returned
--   returned         → completed
--   completed / cancelled / damage_claimed → 전환 불가 (terminal)
--   cancelled·damage_claimed는 위 "정상 다음 단계" 표와 무관하게, 종료되지 않은 예약이면
--   어느 단계에서나 예외적으로 허용 (예약취소·파손신고 — rental-lifecycle.md 확정 정책)
--
-- 호출처 전수 확인(2026-08-05): cms/reservation(approveReservation/updateStatus),
--   cms/mobile/qr(processQrAction), api/contracts/[token]/sign, api/checkout/confirm-mock,
--   api/checkout/remove-item — 전부 위 정책과 일치하는 전이만 사용 중이라 기존 동작 변화 없음.

CREATE OR REPLACE FUNCTION public.update_reservation_status(p_reservation_id bigint, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_pickup_method  TEXT;
  v_return_method  TEXT;
  v_allowed_next   TEXT;
  v_updated_count  INT;
BEGIN
  SELECT status, pickup_method, return_method
    INTO v_current_status, v_pickup_method, v_return_method
  FROM rental_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  IF v_current_status IN ('completed', 'cancelled', 'damage_claimed') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 종료된 예약은 상태를 변경할 수 없습니다.');
  END IF;

  -- 취소·파손신고는 종료되지 않은 예약이면 어느 단계에서나 예외적으로 허용
  IF p_new_status IN ('cancelled', 'damage_claimed') THEN
    UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
    WHERE id = p_reservation_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_allowed_next := CASE v_current_status
    WHEN 'pending'           THEN 'hold'
    WHEN 'hold'               THEN 'confirmed'
    WHEN 'confirmed'          THEN CASE WHEN v_pickup_method = 'visit' THEN 'in_use' ELSE 'shipped' END
    WHEN 'shipped'            THEN 'in_use'
    WHEN 'in_use'             THEN CASE WHEN v_return_method = 'visit' THEN 'returned' ELSE 'return_requested' END
    WHEN 'return_requested'   THEN 'returned'
    WHEN 'returned'           THEN 'completed'
    ELSE NULL
  END;

  IF v_allowed_next IS NULL OR p_new_status <> v_allowed_next THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('허용되지 않은 상태 전환입니다. (현재: %s → 요청: %s)', v_current_status, p_new_status)
    );
  END IF;

  UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
  WHERE id = p_reservation_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
