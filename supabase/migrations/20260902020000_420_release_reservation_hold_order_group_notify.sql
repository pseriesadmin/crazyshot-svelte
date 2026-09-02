-- Migration 420: release_reservation_hold() — 만료 알림을 주문(order_items) 단위로 통합 발송
-- 배경(2026-09-02 Stephen 리포트): 같은 상품을 다중수량으로 예약(같은 주문의 형제 예약)했다가
-- 두 예약이 같은 cron 배치에서 함께 30분 만료되면, 지금까지는 예약 건별로
-- send_rental_chat_notification(id, 'hold_expired')을 각각 호출해 고객 채팅창에 내용이
-- 거의 동일한 카드가 2장 이상 중복 노출됐다. 이 함수는 이미 approve_reservation 경로가 쓰는
-- "같은 주문이면 통합 카드 1건"(service-operations.md §4, resolveApprovalNotifyPlan) 원칙을
-- hold_expired 배치 만료에도 동일하게 적용한다.
--
-- 변경 범위: 만료 판정 WHERE 절(D-1 GREATEST 타이머, Migration 394)은 완전히 동일 —
-- 이번 배치에서 실제로 status를 'expired'로 갱신한 예약 id들을 모아뒀다가, 루프 종료 후
-- order_items로 형제관계를 조회해 그룹핑한 뒤 발송하는 후처리 단계만 추가했다.
--   · 같은 주문(order_id)으로 묶인 형제가 이번 배치에서 2건 이상 함께 만료 →
--     send_rental_chat_notification_batch(형제id들, 'hold_expired') 1회만 호출(Migration 419)
--   · 주문에 묶인 형제가 이번 배치에서 1건뿐이거나, order_items 연결 자체가 없는 예약(체크아웃
--     제출 전 draft 등) → 기존과 동일하게 send_rental_chat_notification(id, 'hold_expired')
--     건별 호출 — 가장 흔한 단건 케이스는 문구·동작 전부 무변경.
--   · 알림 실패는 기존과 동일하게 무시(재고 해제가 핵심 기능, 알림은 부가 기능).

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
  v_expired_ids    BIGINT[] := ARRAY[]::BIGINT[];
  v_group          RECORD;
BEGIN
  FOR v_reservation_id IN
    SELECT rr.id
    FROM public.rental_reservations rr
    WHERE rr.status = 'hold'
      -- D-3: 결제완료 예약은 계약서명 여부와 무관하게 항상 제외 (Migration 324 불변 유지)
      AND rr.payment_confirmed_at IS NULL
      -- D-1: 계약서 미발송 → created_at 기준 30분 / 계약서 발송됨 → sent_at 기준 30분 리셋
      -- (Migration 394와 100% 동일 조건 — 이번 변경은 알림 발송 방식만 다룬다)
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
      v_expired_ids := v_expired_ids || v_reservation_id;
    END IF;
  END LOOP;

  IF array_length(v_expired_ids, 1) > 0 THEN
    -- 이번 배치에서 함께 만료된 예약을 order_items 기준으로 그룹핑 — 다른(과거) 배치에서
    -- 이미 만료·확정된 형제는 v_expired_ids에 없으므로 자동으로 이번 그룹에서 제외된다.
    FOR v_group IN
      SELECT oi.order_id, array_agg(oi.reservation_id ORDER BY oi.reservation_id) AS resv_ids
      FROM public.order_items oi
      WHERE oi.reservation_id = ANY(v_expired_ids)
      GROUP BY oi.order_id
    LOOP
      BEGIN
        IF array_length(v_group.resv_ids, 1) > 1 THEN
          PERFORM public.send_rental_chat_notification_batch(v_group.resv_ids, 'hold_expired');
        ELSE
          PERFORM public.send_rental_chat_notification(v_group.resv_ids[1], 'hold_expired');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- 알림 실패는 무시 — 재고 해제(핵심 기능)는 이미 완료된 상태
        NULL;
      END;
    END LOOP;

    -- order_items에 연결이 없는 만료 예약(체크아웃 제출 전 draft 등)은 기존과 동일하게 건별 발송
    FOR v_reservation_id IN
      SELECT x.id
      FROM unnest(v_expired_ids) AS x(id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.order_items oi WHERE oi.reservation_id = x.id
      )
    LOOP
      BEGIN
        PERFORM public.send_rental_chat_notification(v_reservation_id, 'hold_expired');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'expired_count', v_expired_count);
END;
$function$;

-- GRANT은 SECURITY DEFINER 함수에 이미 설정된 서비스롤 권한 그대로 상속 — 재설정 불필요.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 394의 release_reservation_hold() 정의(예약 건별 즉시 알림 발송 버전)로
-- CREATE OR REPLACE
-- ============================================================
