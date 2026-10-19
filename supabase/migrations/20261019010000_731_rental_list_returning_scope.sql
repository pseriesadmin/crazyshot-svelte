-- Migration #731: CMS 대여현황 '반납중' 칩 — get_rental_list 의 p_inspection_scope 에 'returning' 값 추가 (2026-10-19, Stephen 지시)
--   '반납중' = 반납요청(return_requested) + 반납완료·검수대기(returned, 이슈 아님) + 대여중 중 반납 예정일이 오늘(KST) 이전이거나 반납 알림이 발송된 건.
--   검수 이슈(issue)로 등록된 건은 '검수' 칩에만 남는다. 기존 'pending'|'issue' 동작은 그대로.
--   (방문·미지정 반납은 알림 기록이 없어 대여중 상태로는 포함하지 않는다 — 고객 제출·운영자 전환 후 반납중에 들어온다)
-- 라이브 정의의 #724 앵커 줄 2곳만 치환한다(전체 재작성 금지).
-- ROLLBACK: 아래 두 줄을 #724 원문(`-- inspection-724` 줄)으로 되돌려 CREATE OR REPLACE.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_old1 text := E'AND (p_inspection_scope IS NULL OR (rr.status = ''returned'' AND (p_inspection_scope = ''issue'') = (COALESCE(rr.inspection_status, ''pending'') = ''issue''))) -- inspection-724';
  v_old2 text := E'AND (p_inspection_scope IS NULL OR (g.g_status = ''returned'' AND (p_inspection_scope = ''issue'') = g.g_insp_issue)) -- inspection-724';
  v_new1 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (rr.status = ''return_requested'' OR (rr.status = ''returned'' AND COALESCE(rr.inspection_status, ''pending'') <> ''issue'') OR (rr.status = ''in_use'' AND ((rr.end_date <= (now() AT TIME ZONE ''Asia/Seoul'')::date AND rr.return_method IN (''epost'', ''delivery'', ''crazydelivery'', ''airport'', ''quick'', ''locker'')) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = rr.id)))) ELSE (rr.status = ''returned'' AND (p_inspection_scope = ''issue'') = (COALESCE(rr.inspection_status, ''pending'') = ''issue'')) END)) -- inspection-731';
  v_new2 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (g.g_status = ''return_requested'' OR (g.g_status = ''returned'' AND NOT g.g_insp_issue) OR (g.g_status = ''in_use'' AND ((g.b_rental_end <= (now() AT TIME ZONE ''Asia/Seoul'')::date AND g.b_return_method IN (''epost'', ''delivery'', ''crazydelivery'', ''airport'', ''quick'', ''locker'')) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = g.b_rid)))) ELSE (g.g_status = ''returned'' AND (p_inspection_scope = ''issue'') = g.g_insp_issue) END)) -- inspection-731';
  v_cnt int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('inspection-731' in v_def) > 0 THEN RAISE NOTICE '#731 already patched — skip'; RETURN; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#731 patch1 mismatch (%)', v_cnt; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#731 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  EXECUTE v_new;
END
$patch$;
