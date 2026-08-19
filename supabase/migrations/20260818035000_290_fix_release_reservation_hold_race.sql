-- Migration 290: release_reservation_hold() 레이스 컨디션 긴급 수정 (Migration 288 회귀)
-- @sp3-qa-agent 검수 발견(2026-08-18, CRITICAL): Migration 288에서 원자적 bulk UPDATE
-- (WHERE status='hold' AND created_at < ...)를 커서 루프로 바꾸면서, 개별 UPDATE문에
-- status='hold' 재확인 조건을 빠뜨렸다. cron 실행 도중(알림 발송 등 개별 처리 시간 동안)
-- 고객이 결제·서명을 마쳐 해당 예약이 hold→confirmed로 전환·커밋되면, 뒤늦게 실행되는
-- 개별 UPDATE가 상태를 재확인하지 않고 무조건 expired로 덮어써 방금 확정된 예약을 파괴하고
-- 잘못된 "예약이 취소되었습니다" 알림까지 보낼 수 있었다.
--
-- 수정: 개별 UPDATE에 AND status = 'hold' 재확인 조건 복원 + GET DIAGNOSTICS로 실제 갱신된
-- 행에 대해서만 카운트·알림 발송(그 사이 상태가 바뀐 예약은 조용히 건너뜀 — 원래 원자적
-- UPDATE가 갖고 있던 안전장치와 동등한 보장 복원).

CREATE OR REPLACE FUNCTION public.release_reservation_hold()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expired_count  INT := 0;
  v_updated_count  INT;
  v_reservation_id BIGINT;
BEGIN
  FOR v_reservation_id IN
    SELECT id FROM public.rental_reservations
    WHERE status = 'hold' AND created_at < NOW() - INTERVAL '30 minutes'
  LOOP
    UPDATE public.rental_reservations
    SET status = 'expired', updated_at = NOW()
    WHERE id = v_reservation_id
      AND status = 'hold';  -- 커서 스냅샷 이후 다른 트랜잭션이 이미 확정시켰으면 건너뜀

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
      v_expired_count := v_expired_count + 1;

      BEGIN
        PERFORM public.send_rental_chat_notification(v_reservation_id, 'hold_expired');
      EXCEPTION WHEN OTHERS THEN
        -- 알림 실패는 무시 — 재고 해제(핵심 기능)는 계속 진행
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'expired_count', v_expired_count);
END;
$function$;

-- rollback: Migration 288의 release_reservation_hold() 정의로 CREATE OR REPLACE
-- (단, 그건 이번에 고친 레이스 컨디션이 있는 버전이므로 실제로는 롤백하지 말 것 —
-- 필요 시 Migration 285의 단순 bulk UPDATE 버전으로 되돌리는 편이 안전함)
