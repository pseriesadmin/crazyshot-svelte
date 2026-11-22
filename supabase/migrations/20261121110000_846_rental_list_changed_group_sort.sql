-- #846 반납중 탭 기본 정렬 = 반납 전환 최신순 + 같은 반납일 안에서 방식순 (2026-11-21, Stephen 확정)
--   p_sort 에 changed_group_desc / changed_group_asc 추가:
--     상태 전환일(KST 날짜) 내림(오름) → 같은 날 안에서 반납 방식 순서(크레이지배송 0 → 방문·무인함 1 → 퀵 2 → 기타 3) → 전환 시각 내림(오름)
--   #845 가 앞에 끼운 지연 고정 항목은 그대로 앞에 둔다. 시그니처 불변(CREATE OR REPLACE), 라이브 정의 앵커 치환.
-- ROLLBACK: get_rental_list 의 'sort-846' 줄과 그 아래 changed_group 항목을 제거해 재생성.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_tpl text;
  v_single text;
  v_group text;
  v_chg_s text := 'CASE WHEN rr.status = ''hold'' THEN COALESCE(rr.approved_at, cs.sent_at, rr.status_changed_at) ELSE rr.status_changed_at END';
  v_chg_g text := 'CASE WHEN g.g_status = ''hold'' THEN COALESCE(g.b_approved_at, g.b_signing_sent_at, g.b_changed_at) ELSE g.b_changed_at END';
  v_anchor_s text := E'      CASE p_sort WHEN ''code_asc'' THEN rr.reservation_code';
  v_anchor_g text := E'      CASE p_sort WHEN ''code_asc'' THEN g.b_reservation_code';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('sort-845' in v_def) = 0 THEN RAISE EXCEPTION '#846 requires #845'; END IF;
  IF position('sort-846' in v_def) > 0 THEN
    RAISE NOTICE '#846 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  v_tpl :=
    E'      CASE p_sort WHEN ''changed_group_desc'' THEN ({chg} AT TIME ZONE ''Asia/Seoul'')::date END DESC NULLS LAST, -- sort-846\n' ||
    E'      CASE p_sort WHEN ''changed_group_asc'' THEN ({chg} AT TIME ZONE ''Asia/Seoul'')::date END ASC NULLS LAST,\n' ||
    E'      CASE WHEN p_sort IN (''changed_group_desc'', ''changed_group_asc'') THEN private.rental_method_rank({rmethod}) END ASC,\n' ||
    E'      CASE p_sort WHEN ''changed_group_desc'' THEN {chg} END DESC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''changed_group_asc'' THEN {chg} END ASC NULLS LAST,\n';

  v_single := replace(replace(v_tpl, '{chg}', v_chg_s), '{rmethod}', 'rr.return_method');
  v_group := replace(replace(v_tpl, '{chg}', v_chg_g), '{rmethod}', 'g.b_return_method');

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_s, ''))) / length(v_anchor_s);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#846 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_s, v_single || v_anchor_s);

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_g, ''))) / length(v_anchor_g);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#846 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_g, v_group || v_anchor_g);

  EXECUTE v_new;
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) TO service_role;
END
$patch$;
