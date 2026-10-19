-- Migration #725: #724 검수(sp3) 보완 (2026-10-17)
--   M-1: approve_return_inspection 이 이슈 때문에 건너뛴 형제까지 completed_ids 로 돌려줘 아직 완료되지 않은 예약에도 대여완료 포인트가 나가던 문제
--        → 실제로 completed 로 바꾼 예약 id 만 반환.
--   minor: 이슈 해소 때 같은 주문 형제 전체의 열린 이슈 기록을 마감 / 승인·해소 루프의 UPDATE 에 status='returned' 조건 추가(동시 승인 시 오류 대신 건너뜀).
-- ROLLBACK: #724 본문으로 두 함수를 CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.approve_return_inspection(p_reservation_id bigint, p_admin_id uuid)
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
  IF v_status <> 'returned' THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납완료 상태에서만 검수 승인을 할 수 있습니다.');
  END IF;
  IF COALESCE(v_insp, 'pending') = 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 건이에요. 이슈를 처리한 뒤 완료할 수 있습니다.');
  END IF;

  v_ids := public.inspection_target_ids(p_reservation_id);
  FOREACH v_id IN ARRAY v_ids LOOP
    -- 이슈가 있는 형제·이미 처리된 형제는 건드리지 않는다(요청 예약은 위에서 이슈 아님을 확인)
    UPDATE rental_reservations
       SET inspection_status = 'pass', inspected_at = now(), inspected_by = p_admin_id
     WHERE id = v_id AND status = 'returned' AND COALESCE(inspection_status, 'pending') <> 'issue';
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
  v_res    jsonb;
BEGIN
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' OR COALESCE(v_insp, 'pending') <> 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 반납완료 건만 해소할 수 있습니다.');
  END IF;

  v_ids := public.inspection_target_ids(p_reservation_id);

  -- 같은 주문 형제 전체의 열린 이슈 기록을 마감한다(이슈 기록은 등록을 요청한 예약 id 에만 쌓인다)
  UPDATE reservation_inspection_issues
     SET resolved_at = now(), resolved_by = p_admin_id, resolution_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE reservation_id = ANY(v_ids) AND resolved_at IS NULL;

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE rental_reservations
       SET inspection_status = 'resolved', inspected_at = now(), inspected_by = p_admin_id
     WHERE id = v_id AND status = 'returned' AND inspection_status = 'issue';
    IF FOUND THEN
      v_res := public.update_reservation_status(v_id, 'completed');
      IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
        RAISE EXCEPTION '%', COALESCE(v_res->>'error', '완료 처리에 실패했습니다.');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_return_inspection(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_return_inspection(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) TO service_role;
