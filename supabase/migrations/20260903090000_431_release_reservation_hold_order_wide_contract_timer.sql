-- Migration 431: release_reservation_hold() — D-1 계약타이머를 주문(order) 단위로 확장
-- (2026-09-03: 파일번호 421→429→431 재명명(429도 재충돌 발견) — 병렬 세션 작업물과 421 번호·타임스탬프 충돌 발견,
--  Stephen 지시로 재명명. DB에는 이미 적용 완료된 상태라 기능 변경 없음, 파일 정합성만 정리)
-- 배경(2026-09-02 Stephen 리포트로 발견 + 실증 확인): 2026-08-31 확정 설계 원칙
-- ("예약 단위 = 주문 단위 — 장바구니에 상품이 몇 개 담기든 하나의 주문에는 전자계약이
-- 정확히 1건만 존재해야 한다", init-contract/+server.ts 주석)에 따라 contracts.reservation_id는
-- 그 주문에 속한 형제 예약 중 계약을 최초로 발행한 "단 하나"만 가리킨다. 그런데
-- release_reservation_hold()의 D-1 타이머 리셋 조건(Migration 394)은 그 사실을 모른 채
-- `contracts.reservation_id = rr.id`로 예약 자기 자신의 id만 직접 비교했다 — 그 결과 계약을
-- "소유"한 예약 1건만 발송 시점 기준으로 30분이 리셋되고, 같은 주문의 나머지 형제 예약은
-- 똑같이 그 계약서가 발송·서명되고 있는 중인데도 자기 created_at 기준 30분이 지나면 그대로
-- expired로 떨어져 나갔다 — "하나의 주문 = 하나의 계약+결제"라는 설계 원칙이 HOLD 만료
-- 타이머에서만 깨져 있던 구조적 공백.
--
-- 실증: 프로덕션(vnbpmvxruyciuuaermyh)에서 order_items 기준 같은 주문 내 예약 상태가 갈린
-- 실사례 확인 — 주문 #14(예약 90·91 expired / 93만 confirmed), 주문 #13(예약 43·44·45·46
-- expired / 47만 confirmed). stage에서도 동일 조건(형제 예약 2건 중 1건만 계약 소유)으로
-- 재현 후 즉시 정리 완료.
--
-- 수정 범위: D-1 서브쿼리의 계약 매칭 조건만 "자기 자신의 reservation_id"에서 "같은 주문
-- (order_items 기준) 형제 예약 전체의 reservation_id"로 확장 — init-contract/+server.ts의
-- sameOrderReservationIds·resolveApprovalNotifyPlan과 동일한 order_items 조인 패턴을 재사용.
-- order_items 연결이 아예 없는 예약(체크아웃 제출 전 등)은 하위 쿼리가 빈 집합을 반환해
-- 기존과 동일하게 자기 created_at 기준으로만 판정된다(회귀 없음). D-3(payment_confirmed_at)·
-- Migration 420(주문 단위 알림 통합)은 완전히 그대로 유지.

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
      -- D-1: 계약서 미발송(또는 형제 예약 포함 전체 미발송) → created_at 기준 30분
      --      계약서 발송됨(자기 자신 또는 "같은 주문" 형제 예약 중 누구 것이든) → 그
      --      발송 시점(sent_at) 기준 30분 리셋 — 주문 전체가 하나의 계약을 공유하므로
      --      형제 중 누구든 계약이 발송돼 있으면 주문 전체의 타이머가 함께 늘어나야 한다.
      AND GREATEST(
            rr.created_at,
            COALESCE(
              (
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
    -- (Migration 420과 동일 — 이번 수정과 무관, 그대로 유지)
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
-- Migration 420의 release_reservation_hold() 정의(D-1이 자기 reservation_id만 보던 버전)로
-- CREATE OR REPLACE
-- ============================================================
