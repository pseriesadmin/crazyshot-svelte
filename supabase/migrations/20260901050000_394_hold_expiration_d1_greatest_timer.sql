-- Migration 394: HOLD D-1 타이머 — NOT EXISTS → GREATEST(created_at, sent_at) 교체
-- TASK.md Stage 4 — GATE B Q6 확정 정책 (EC-5b RED → GREEN)
--
-- 배경(Migration 324 D-1 문제):
--   계약서가 발송된(contract_signings.sent_at IS NOT NULL) hold를 범용 30분 타이머에서
--   완전히 제외(NOT EXISTS)하면, 고객이 장기간 서명하지 않아도 hold가 영구히 재고를 점유한다.
--   계약 발송 1시간 후에도 만료 안 되는 상태로, 재고 회전에 지장을 준다.
--
-- 수정 내용(D-1만 변경, D-3는 완전히 유지):
--   기존: NOT EXISTS (계약 발송됐으면 만료 대상에서 영구 제외)
--   변경: GREATEST(rr.created_at, 최신 sent_at) + 30분 기준 만료
--
--   즉 계약서가 발송된 순간부터 타이머가 sent_at 기준으로 리셋된다.
--   고객이 30분 안에 서명·결제를 완료하지 않으면 hold가 만료돼 재고가 해제된다.
--   계약서가 발송되지 않은 hold는 기존과 동일하게 created_at 기준 30분 만료.
--
-- D-3 불변:
--   결제완료(payment_confirmed_at IS NOT NULL) 예약은 이번 변경과 무관하게 항상 제외.
--   이 예외는 "결제만 먼저 완료된" 구흐름 예약 보호 목적으로 그대로 유지.
--
-- 기타 로직(개별 UPDATE status='hold' 재확인, GET DIAGNOSTICS, hold_expired 알림)은
-- Migration 324와 100% 동일 — WHERE 절의 D-1 조건만 교체.

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
      -- D-3: 결제완료 예약은 계약서명 여부와 무관하게 항상 제외 (Migration 324 불변 유지)
      AND rr.payment_confirmed_at IS NULL
      -- D-1 변경: NOT EXISTS(계약 발송됐으면 영구 제외) → GREATEST 타이머 리셋
      --   계약서 미발송 → GREATEST(created_at, created_at) = created_at 기준 30분
      --   계약서 발송됨 → GREATEST(created_at, max_sent_at) = sent_at 기준 30분 리셋
      AND GREATEST(
            rr.created_at,
            COALESCE(
              (
                SELECT MAX(cs.sent_at)
                FROM public.contracts c
                JOIN public.contract_signings cs ON cs.contract_id = c.id
                WHERE c.reservation_id = rr.id
                  AND cs.sent_at IS NOT NULL
              ),
              rr.created_at
            )
          ) < NOW() - INTERVAL '30 minutes'
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

-- GRANT은 SECURITY DEFINER 함수에 이미 설정된 서비스롤 권한 그대로 상속 — 재설정 불필요.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 324의 release_reservation_hold() 정의(NOT EXISTS 버전)로 CREATE OR REPLACE
-- ============================================================
