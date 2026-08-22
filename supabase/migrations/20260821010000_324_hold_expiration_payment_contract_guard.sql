-- Migration 324: HOLD 30분 자동만료 크론 방어조건 보강
-- TASK.md "예약 결제·계약서명 순서 재설계"(2026-08-21) Phase D — GATE B Q6 확정(D-1+D-3만 구현,
-- D-2 서명링크 만료 후 미서명 hold 정리 크론은 별도 아젠다로 보류).
--
-- 배경: 결제(mock) 트리거가 cart 체크아웃(1단계)에서 계약서명 완료 시점(3단계)으로 이동하면서,
-- "고객이 계약서명은 했지만 아직 결제(mock) 버튼을 누르기 전" 구간이 새로 생긴다. 이 구간이
-- 30분을 넘기면 release_reservation_hold() 범용 타이머가 여전히 해당 hold를 파괴할 수 있다
-- (이번 아젠다의 발단이 된 reservation_id 2657/2658 레이스 컨디션의 신규 흐름판).
--
-- 수정 내용(release_reservation_hold() CREATE OR REPLACE, Migration 290 정의 위에 조건 2개 추가):
--   D-1: 계약이 발송된(contract_signings.sent_at IS NOT NULL) hold는 범용 30분 타이머에서
--        제외한다 — 계약 발송 이후(2단계 계약대기 진입)의 만료 판단은 서명링크 만료
--        (contract_signings.expires_at) 기준으로 넘긴다(D-2, 이번 스코프 제외).
--   D-3: 결제완료(payment_confirmed_at IS NOT NULL) 예약은 계약서명 여부와 무관하게 항상
--        제외한다 — Phase B~C 배포 전환 구간 동안 잔존할 수 있는 "결제만 먼저 완료된" 구
--        흐름 예약을 보호한다(D-1과 함께 유지).
--
-- 그 외 로직(개별 UPDATE의 status='hold' 재확인 + GET DIAGNOSTICS 카운트, hold_expired 알림
-- 발송)은 Migration 290과 100% 동일 — 커서 SELECT의 WHERE 절에만 조건을 추가한다.

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
    SELECT rr.id
    FROM public.rental_reservations rr
    WHERE rr.status = 'hold'
      AND rr.created_at < NOW() - INTERVAL '30 minutes'
      -- D-3: 결제완료 예약은 계약서명 여부와 무관하게 항상 제외(과도기 방어)
      AND rr.payment_confirmed_at IS NULL
      -- D-1: 계약이 발송된 hold는 범용 30분 타이머에서 제외
      AND NOT EXISTS (
        SELECT 1
        FROM public.contracts c
        JOIN public.contract_signings cs ON cs.contract_id = c.id
        WHERE c.reservation_id = rr.id
          AND cs.sent_at IS NOT NULL
      )
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

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 290의 release_reservation_hold() 정의(payment_confirmed_at/contract_signings
-- 조건 없는 버전)로 CREATE OR REPLACE
-- ============================================================
