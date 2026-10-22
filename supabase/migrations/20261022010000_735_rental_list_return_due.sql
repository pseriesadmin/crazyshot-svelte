-- Migration #735: CMS 대여현황 '대여중'→'반납중' 자동 전환 — 반납 일시(반납일 + 반납시각, KST)가 지난 대여중 예약은 방식 무관 '반납중' 칩으로 (2026-10-22, Stephen 지시)
--   · private.rental_return_due(end_date, return_time): 반납 일시 도래 판정. 반납시각이 없거나 형식 오류면 18:00, 24:00은 그날 끝(다음날 0시)으로 본다.
--   · p_inspection_scope='returning' 의 대여중 분기: (반납 일시 도래 OR 반납 안내 발송 기록) — 반납 방식 제한 제거(방문 포함).
--   · p_inspection_scope='in_use_pending' 신설: '대여중' 칩 — 반납 일시 전이고 안내 발송 기록도 없는 대여중만(반납중으로 옮겨간 건 제외).
-- 라이브 정의의 #731 앵커 줄 2곳만 치환한다(전체 재작성 금지).
-- ROLLBACK: 아래 두 줄을 #731 원문(`-- inspection-731` 줄)으로 되돌려 CREATE OR REPLACE, DROP FUNCTION private.rental_return_due(date, text).

CREATE OR REPLACE FUNCTION private.rental_return_due(p_end date, p_return_time text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_now_min integer := (EXTRACT(hour FROM (now() AT TIME ZONE 'Asia/Seoul'))::integer * 60 + EXTRACT(minute FROM (now() AT TIME ZONE 'Asia/Seoul'))::integer);
  v_m text[];
  v_due_min integer;
BEGIN
  IF p_end IS NULL THEN RETURN false; END IF;
  IF p_end < v_today THEN RETURN true; END IF;
  IF p_end > v_today THEN RETURN false; END IF;
  v_m := regexp_match(COALESCE(p_return_time, ''), '^\s*(\d{1,2}):(\d{2})');
  IF v_m IS NULL THEN
    v_due_min := 18 * 60;
  ELSE
    v_due_min := v_m[1]::integer * 60 + v_m[2]::integer;
  END IF;
  RETURN v_now_min >= v_due_min;
END;
$$;
REVOKE ALL ON FUNCTION private.rental_return_due(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.rental_return_due(date, text) TO service_role;

DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_old1 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (rr.status = ''return_requested'' OR (rr.status = ''returned'' AND COALESCE(rr.inspection_status, ''pending'') <> ''issue'') OR (rr.status = ''in_use'' AND ((rr.end_date <= (now() AT TIME ZONE ''Asia/Seoul'')::date AND rr.return_method IN (''epost'', ''delivery'', ''crazydelivery'', ''airport'', ''quick'', ''locker'')) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = rr.id)))) ELSE (rr.status = ''returned'' AND (p_inspection_scope = ''issue'') = (COALESCE(rr.inspection_status, ''pending'') = ''issue'')) END)) -- inspection-731';
  v_old2 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (g.g_status = ''return_requested'' OR (g.g_status = ''returned'' AND NOT g.g_insp_issue) OR (g.g_status = ''in_use'' AND ((g.b_rental_end <= (now() AT TIME ZONE ''Asia/Seoul'')::date AND g.b_return_method IN (''epost'', ''delivery'', ''crazydelivery'', ''airport'', ''quick'', ''locker'')) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = g.b_rid)))) ELSE (g.g_status = ''returned'' AND (p_inspection_scope = ''issue'') = g.g_insp_issue) END)) -- inspection-731';
  v_new1 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (rr.status = ''return_requested'' OR (rr.status = ''returned'' AND COALESCE(rr.inspection_status, ''pending'') <> ''issue'') OR (rr.status = ''in_use'' AND (private.rental_return_due(rr.end_date, rr.return_time) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = rr.id)))) WHEN p_inspection_scope = ''in_use_pending'' THEN (rr.status = ''in_use'' AND NOT private.rental_return_due(rr.end_date, rr.return_time) AND NOT EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = rr.id)) ELSE (rr.status = ''returned'' AND (p_inspection_scope = ''issue'') = (COALESCE(rr.inspection_status, ''pending'') = ''issue'')) END)) -- inspection-735';
  v_new2 text := E'AND (p_inspection_scope IS NULL OR (CASE WHEN p_inspection_scope = ''returning'' THEN (g.g_status = ''return_requested'' OR (g.g_status = ''returned'' AND NOT g.g_insp_issue) OR (g.g_status = ''in_use'' AND (private.rental_return_due(g.b_rental_end, g.b_return_time) OR EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = g.b_rid)))) WHEN p_inspection_scope = ''in_use_pending'' THEN (g.g_status = ''in_use'' AND NOT private.rental_return_due(g.b_rental_end, g.b_return_time) AND NOT EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = g.b_rid)) ELSE (g.g_status = ''returned'' AND (p_inspection_scope = ''issue'') = g.g_insp_issue) END)) -- inspection-735';
  v_cnt int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('inspection-735' in v_def) > 0 THEN RAISE NOTICE '#735 already patched — skip'; RETURN; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#735 patch1 mismatch (%)', v_cnt; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#735 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  EXECUTE v_new;
END
$patch$;
