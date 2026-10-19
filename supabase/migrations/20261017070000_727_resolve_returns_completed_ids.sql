-- Migration #727: 이슈 해소 RPC 가 실제로 completed 로 바꾼 예약 id 를 돌려준다 (2026-10-17, Stephen 확정)
--   정책: 이슈를 해소(완료-추가청구)한 건에도 대여완료 포인트를 적립한다(알림은 보내지 않음). 서버가 이 id 목록에 적립을 호출한다.
-- ROLLBACK: #726 본문으로 resolve_return_inspection_issue 를 CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.resolve_return_inspection_issue(p_reservation_id bigint, p_admin_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_insp   text;
  v_ids    bigint[];
  v_id     bigint;
  v_done   bigint[] := ARRAY[]::bigint[];
  v_res    jsonb;
BEGIN
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' OR COALESCE(v_insp, 'pending') <> 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 반납완료 건만 해소할 수 있습니다.');
  END IF;

  v_ids := public.inspection_target_ids(p_reservation_id);

  UPDATE reservation_inspection_issues
     SET resolved_at = now(), resolved_by = p_admin_id, resolution_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE resolved_at IS NULL
     AND (reservation_id = p_reservation_id
          OR reservation_id IN (SELECT oi2.reservation_id FROM order_items oi2
                                 WHERE oi2.order_id = (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1)));

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE rental_reservations
       SET inspection_status = 'resolved', inspected_at = now(), inspected_by = p_admin_id
     WHERE id = v_id AND status = 'returned' AND inspection_status = 'issue';
    IF FOUND THEN
      v_res := public.update_reservation_status(v_id, 'completed');
      IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
        RAISE EXCEPTION '%', COALESCE(v_res->>'error', '완료 처리에 실패했습니다.');
      END IF;
      v_done := v_done || v_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'completed_ids', to_jsonb(v_done));
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) TO service_role;
