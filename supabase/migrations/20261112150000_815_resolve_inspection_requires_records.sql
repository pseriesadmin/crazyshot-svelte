-- Migration #815: 검수 이슈 해소(완료 처리)도 상품별 반납 기록 확인 (2026-11-12, #813 sp3 MAJOR 반영)
--   approve_return_inspection(#813)만 막으면 '검수' 칩의 [완료 처리(추가청구)] 경로(resolve_return_inspection_issue)로
--   기록 없는 상품이 있는 주문이 완료될 수 있었다 → 같은 return_records_missing 확인을 추가한다.
--   기준 본문은 #727(직전 정의: #724→#725→#726 형제 이슈 전체 마감→#727 completed_ids 반환) — 확인 한 단계 외 동일.
-- ROLLBACK: resolve_return_inspection_issue 를 #727 본문으로 CREATE OR REPLACE.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). #813 이후, 코드와 같은 시점에 적용한다(DB 먼저·코드 나중).

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
  v_missing bigint[];
BEGIN
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' OR COALESCE(v_insp, 'pending') <> 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 반납완료 건만 해소할 수 있습니다.');
  END IF;

  -- 상품별 반납 기록 확인(#815) — 이슈 해소로 완료 처리될 때도 모든 상품에 기록(고객 제출 또는 관리자 대리 등록)이 있어야 한다
  v_missing := public.return_records_missing(p_reservation_id);
  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납 정보가 등록되지 않은 상품이 있어요. 모든 상품의 반납 정보를 등록한 뒤 완료해 주세요.', 'missing_ids', to_jsonb(v_missing));
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
