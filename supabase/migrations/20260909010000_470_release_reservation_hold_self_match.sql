-- CMS 전역 전수검증(2026-09-09) — release_reservation_hold() self-join 자기매칭 결함 수정
--
-- Migration #453의 D-1 서브쿼리는 "같은 주문(order_items)에 묶인 형제 예약 중 계약이
-- 발송된 게 있는지"를 self-join(oi1.reservation_id = rr.id, oi2.order_id = oi1.order_id)으로
-- 찾는다. 그런데 이 예약 자신이 아직 order_items에 없으면(장바구니 체크아웃 제출 전 —
-- service-operations.md §4에 명시된 정상 상태) self-join 자체가 빈 집합을 반환해,
-- 이미 발송된 자기 자신의 계약조차 찾지 못한다. 결과: 30분 타이머가 영원히 시작되지 않고
-- 재고가 무기한 점유된다.
--
-- 수정: "형제 예약(self-join)" 매칭에 "자기 자신 직접 매칭(c.reservation_id = rr.id)"을
-- OR로 추가한다. order_items 연결 여부와 무관하게 자기 자신의 계약 발송 사실은 항상
-- 찾을 수 있고, order_items 연결이 생긴 뒤에는 기존 형제 예약 매칭도 그대로 동작한다.
--
-- 회귀 검증: src/__tests__/services/holdExpirationContractTimer.test.ts (EC-5a~c 무변경,
-- EC-6/EC-6-edge 신규)

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
      AND rr.payment_confirmed_at IS NULL
      AND (
            SELECT MAX(cs.sent_at)
            FROM public.contracts c
            JOIN public.contract_signings cs ON cs.contract_id = c.id
            WHERE cs.sent_at IS NOT NULL
              AND (
                c.reservation_id = rr.id
                OR c.reservation_id IN (
                  SELECT oi2.reservation_id
                  FROM public.order_items oi1
                  JOIN public.order_items oi2 ON oi2.order_id = oi1.order_id
                  WHERE oi1.reservation_id = rr.id
                )
              )
          ) < NOW() - INTERVAL '30 minutes'
  LOOP
    UPDATE public.rental_reservations
    SET status = 'expired', updated_at = NOW()
    WHERE id = v_reservation_id
      AND status = 'hold';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
      v_expired_count := v_expired_count + 1;
      v_expired_ids := v_expired_ids || v_reservation_id;
    END IF;
  END LOOP;

  IF array_length(v_expired_ids, 1) > 0 THEN
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
