-- Migration #813: 반납 기록은 상품(예약)별 필수 — 검수 승인 전 상품별 기록 확인 (2026-11-12, Stephen 지시)
--   한 주문(order_items.order_id)에 상품이 여러 개면 모든 상품이 각자 반납 기록(고객 제출 reservation_return_submissions 또는
--   관리자 대리 등록 reservation_return_admin_entries)을 가져야 검수 승인(approve_return_inspection)이 된다. 고객·관리자 누가 등록했든 같다.
--   소급 없음(Stephen 기본안): 이 마이그레이션 적용 시점에 이미 반납요청·반납완료인 예약은 return_record_exempt=true 로 면제한다.
--   (적용 시점에 따라 면제 대상이 정해지므로 Production 은 Production 적용 시점 기준으로 따로 표시된다.)
--   1) rental_reservations.return_record_exempt boolean — 면제 표시(기본 false)
--   2) return_records_missing(bigint) — 승인 대상 주문에서 기록이 없는 상품(예약) id 목록(대표 + 같은 주문의 대여중·반납요청·반납완료, 면제 제외)
--   3) approve_return_inspection — 기록이 없는 상품이 있으면 승인 거절(#725 본문 그대로 + 확인 한 단계)
-- ROLLBACK: approve_return_inspection 을 #725 본문으로 CREATE OR REPLACE · DROP FUNCTION public.return_records_missing(bigint) ·
--           ALTER TABLE public.rental_reservations DROP COLUMN return_record_exempt;
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드(API·화면)와 같은 시점에 적용한다.

ALTER TABLE public.rental_reservations ADD COLUMN IF NOT EXISTS return_record_exempt boolean NOT NULL DEFAULT false;

-- 소급 면제 — 이 시점에 이미 반납요청·반납완료인 예약(상태 트리거는 status 컬럼 변경에만 반응하므로 영향 없음)
UPDATE public.rental_reservations
   SET return_record_exempt = true
 WHERE status IN ('return_requested', 'returned') AND return_record_exempt = false;

CREATE OR REPLACE FUNCTION public.return_records_missing(p_reservation_id bigint)
RETURNS bigint[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), ARRAY[]::bigint[])
    FROM rental_reservations r
   WHERE r.status IN ('in_use', 'return_requested', 'returned')
     AND NOT r.return_record_exempt
     AND (r.id = p_reservation_id
          OR r.id IN (SELECT oi2.reservation_id FROM order_items oi2
                       WHERE oi2.order_id = (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1)))
     AND NOT EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM reservation_return_admin_entries e WHERE e.reservation_id = r.id);
$$;

REVOKE ALL ON FUNCTION public.return_records_missing(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_records_missing(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_return_inspection(p_reservation_id bigint, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status  text;
  v_insp    text;
  v_ids     bigint[];
  v_id      bigint;
  v_done    bigint[] := ARRAY[]::bigint[];
  v_res     jsonb;
  v_missing bigint[];
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

  -- 상품별 반납 기록 확인(#813) — 고객 제출 또는 관리자 대리 등록이 없는 상품이 있으면 승인하지 않는다
  v_missing := public.return_records_missing(p_reservation_id);
  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납 정보가 등록되지 않은 상품이 있어요. 모든 상품의 반납 정보를 등록한 뒤 승인해 주세요.', 'missing_ids', to_jsonb(v_missing));
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

REVOKE ALL ON FUNCTION public.approve_return_inspection(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_return_inspection(bigint, uuid) TO service_role;
