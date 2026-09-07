-- Migration 453: release_reservation_hold() — HOLD 만료 정책 전면 개편
-- (2026-09-07, Stephen 확정 — 기존 "생성 후 30분(계약 발송 시 GREATEST로 리셋)" 정책을
--  "계약이 발송된 적이 있을 때만, 그 발송 시점 기준으로만 30분" 정책으로 뒤집음)
--
-- 배경: 기존(Migration 394/420/431) 정책은 GREATEST(created_at, 계약발송시각)를 써서 계약이
-- 전혀 발송되지 않은 hold도 created_at만으로 30분 뒤 expired 처리했다. Stephen 지시:
--   "고객 '예약신청완료' 건의 hold 타이머 없앨 것 — 전자계약 발행 또는 예약취소(고객 본인),
--    관리자 예약 거부 실행 전까지 해당 예약상품 재고점유 유지"
--   "cms '계약서'탭에서 전자계약 발행 직후 'hold 30분' 적용"
-- 즉 30분 타이머는 계약이 "발송"(contract_signings.sent_at)된 시점부터만 시작해야 하고,
-- 계약이 한 번도 발송되지 않은 hold는 생성 후 아무리 오래 지나도 이 함수가 건드리면 안 된다.
--
-- 수정 범위: WHERE절에서 created_at을 GREATEST/COALESCE 폴백으로 쓰던 부분을 제거하고,
-- "같은 주문 형제 예약 포함 계약서명 발송시각의 최댓값"만을 기준으로 삼는다. 그 값이 NULL이면
-- (=계약이 한 번도 발송된 적 없으면) `NULL < NOW() - INTERVAL '30 minutes'`가 SQL 3치논리상
-- 자동으로 FALSE 취급되어 해당 hold는 후보에서 원천 제외된다(별도 EXISTS 불필요).
-- D-3(payment_confirmed_at)·주문 전체 형제 예약 서브쿼리 구조(Migration 431)·배치 알림 로직은
-- 전부 그대로 유지 — 이 부분들은 이번 정책 변경과 무관하고 이미 옳은 설계다.
--
-- 관리자 거부(update_reservation_status → 'cancelled')·고객 본인 취소(동일 RPC)는 이미
-- 'cancelled' 상태로 즉시 전이하므로 이 함수와 별개로 요구사항이 충족된다(추가 변경 불필요).

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
      -- D-1(2026-09-07 전면 개편): 계약서가 "발송"(자기 자신 또는 같은 주문 형제 예약 중
      --      누구 것이든)된 적이 있을 때만 그 발송 시각(sent_at) 기준 30분으로 만료 판정.
      --      계약이 한 번도 발송되지 않았으면 서브쿼리가 NULL을 반환하고, NULL < ... 비교는
      --      FALSE로 취급되어 이 hold는 생성 후 시간이 얼마나 지났든 후보에서 제외된다 —
      --      더 이상 created_at은 어떤 형태로도 만료 판정에 관여하지 않는다.
      AND (
            SELECT MAX(cs.sent_at)
            FROM public.contracts c
            JOIN public.contract_signings cs ON cs.contract_id = c.id
            WHERE cs.sent_at IS NOT NULL
              AND c.reservation_id IN (
                SELECT oi2.reservation_id
                FROM public.order_items oi1
                JOIN public.order_items oi2 ON oi2.order_id = oi1.order_id
                WHERE oi1.reservation_id = rr.id
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
    -- 이번 배치에서 함께 만료된 예약을 order_items 기준으로 그룹핑 (Migration 420과 동일,
    -- 이번 수정과 무관 — 그대로 유지)
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
        NULL;
      END;
    END LOOP;

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
-- Migration 431의 release_reservation_hold() 정의(주문 전체 형제 예약 대조 +
-- GREATEST(created_at, sent_at) 30분 리셋 버전, 계약 미발송 시 created_at 기준 30분
-- 자동만료 포함)로 CREATE OR REPLACE 복원
-- ============================================================
