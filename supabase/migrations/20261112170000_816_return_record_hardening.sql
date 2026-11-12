-- Migration #816: 반납 기록 상품별 필수(#813·#815) 후속 보강 — 경미 이월 사항 해소 (2026-11-12, Stephen 지시)
--   1) award_return_register_mission_points — 반납등록 미션 포인트를 '주문당 1회'로(같은 주문의 다른 예약이 이미 받았으면 지급 안 함, 잠금 키도 주문 단위).
--      (부분 승인 등으로 한 주문이 두 번에 나눠 승인돼도 포인트가 두 번 나가지 않는다.)
--   2) rental_inspection_status_guard — 반납완료→완료 전환 때 상품별 반납 기록 확인을 트리거에도 둔다(승인·해소 함수 외 경로로 검수 상태를 직접 바꿔도 기록 없는 완료 불가).
--   3) reservation_return_media 에 (submission_id, storage_path) 유일 인덱스 — 동시 이중 제출로 같은 사진 행이 두 번 쌓이지 않게(저장 코드는 중복 무시 upsert).
--   (2 보충) 트리거 함수는 SECURITY DEFINER + search_path 고정 — service_role 전용인 return_records_missing 을 호출하므로, CMS 직원이 브라우저 세션(authenticated)으로 직접 완료 UPDATE 해도
--   '권한 없음' 오류가 아니라 의도한 INSPECTION_REQUIRED / RETURN_RECORD_REQUIRED 로 거절된다(sp5·sp6 지적 반영).
-- ROLLBACK: DROP INDEX reservation_return_media_sub_path_uq; rental_inspection_status_guard 를 #724 본문으로, award_return_register_mission_points 를 #741 본문으로 CREATE OR REPLACE.
--   (guard 를 #724 본문으로 되돌리면 return_records_missing 참조가 없어지므로 #813 보다 먼저 되돌려도 안전하다. 이미 지급된 포인트는 되돌리지 않는다.)
-- ⚠ 적용 순서: 반드시 #813 이후(트리거가 return_records_missing 을 호출 — 순서를 어기면 Production 의 모든 반납완료→완료 전환이 함수 없음 오류로 막힌다).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). #813·#815 이후, 코드와 같은 시점에 적용(DB 먼저·코드 나중).

CREATE OR REPLACE FUNCTION public.award_return_register_mission_points(p_reservation_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID;
  v_amount      INT;
  v_is_active   BOOLEAN;
  v_new_balance INT;
  v_okey        text;
BEGIN
  -- 주문 묶음 키: 예약이 속한 주문 id, 주문 연결이 없으면 자기 id(단독 취급)
  v_okey := COALESCE((SELECT MIN(oi.order_id)::text FROM order_items oi WHERE oi.reservation_id = p_reservation_id),
                     'r' || p_reservation_id::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('return_register_mission:' || v_okey, 0));

  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_type = 'return_register_mission'
       AND (ref_id = p_reservation_id::text
            OR ref_id IN (SELECT oi2.reservation_id::text FROM order_items oi2 WHERE oi2.order_id::text = v_okey))
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_granted', true);
  END IF;

  SELECT rr.user_id
    INTO v_user_id
    FROM public.rental_reservations rr
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  SELECT amount, is_active
    INTO v_amount, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'return_register_mission';

  IF v_amount IS NULL OR v_is_active IS NOT TRUE OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rule_inactive');
  END IF;

  UPDATE public.user_profiles
     SET points = points + v_amount
   WHERE user_id = v_user_id
  RETURNING points INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  INSERT INTO public.point_transactions(
    user_id, type, amount, balance_after, description, ref_type, ref_id
  )
  VALUES (
    v_user_id, 'earn', v_amount, v_new_balance,
    '반납등록 미션 적립', 'return_register_mission', p_reservation_id::text
  );

  RETURN jsonb_build_object('success', true, 'amount', v_amount, 'new_balance', v_new_balance);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rental_inspection_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
    NEW.inspection_status := CASE WHEN NEW.has_prior_issue THEN 'issue' ELSE 'pending' END;
  END IF;
  IF NEW.status = 'completed' AND OLD.status = 'returned'
     AND COALESCE(NEW.inspection_status, '') NOT IN ('pass', 'resolved') THEN
    RAISE EXCEPTION 'INSPECTION_REQUIRED: 반납 검수 승인 없이는 완료 처리할 수 없습니다.';
  END IF;
  -- 상품별 반납 기록 확인(#816) — 같은 주문 상품 중 기록(고객 제출·관리자 대리 등록)이 없고 면제도 아닌 것이 있으면 완료 불가
  IF NEW.status = 'completed' AND OLD.status = 'returned'
     AND COALESCE(array_length(public.return_records_missing(NEW.id), 1), 0) > 0 THEN
    RAISE EXCEPTION 'RETURN_RECORD_REQUIRED: 반납 정보가 등록되지 않은 상품이 있어 완료 처리할 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS reservation_return_media_sub_path_uq
  ON public.reservation_return_media (submission_id, storage_path);
