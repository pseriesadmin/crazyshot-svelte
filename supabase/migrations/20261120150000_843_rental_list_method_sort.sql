-- #843 예약대여현황 수령방식·반납방식 헤더 정렬 키 추가 (2026-11-20, Stephen 지시)
--   p_sort 에 pickup_method_asc/desc · return_method_asc/desc 추가 — 방식 순서(크레이지배송 0 → 방문·무인함 1 → 퀵 2 → 기타 3, private.rental_method_rank)를
--   먼저 정렬하고 같은 방식 안에서는 일정(수령일·시각 / 반납일·시각) 순. desc 는 방식 순서의 역순.
--   #842 가 만든 get_rental_list 의 단건·묶음 두 ORDER BY 앞에 항목만 끼워 넣는다(라이브 정의 앵커 치환, 시그니처 불변 → CREATE OR REPLACE).
-- ROLLBACK: get_rental_list 의 'sort-843' 줄(두 곳)을 제거해 재생성.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_tpl text;
  v_single text;
  v_group text;
  v_anchor_s text := E'    ORDER BY\n      CASE WHEN p_sort = ''delay_pickup_asc'' THEN CASE WHEN private.rental_pickup_due(rr.start_date, rr.pickup_time) THEN 0 ELSE 1 END';
  v_anchor_g text := E'    ORDER BY\n      CASE WHEN p_sort = ''delay_pickup_asc'' THEN CASE WHEN private.rental_pickup_due(g.b_rental_start, g.b_pickup_time) THEN 0 ELSE 1 END';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('sort-842' in v_def) = 0 THEN RAISE EXCEPTION '#843 requires #842'; END IF;
  IF position('sort-843' in v_def) > 0 THEN
    RAISE NOTICE '#843 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  v_tpl :=
    E'    ORDER BY\n' ||
    E'      CASE p_sort WHEN ''pickup_method_asc'' THEN private.rental_method_rank({pmethod}) WHEN ''pickup_method_desc'' THEN -private.rental_method_rank({pmethod})\n' ||
    E'                  WHEN ''return_method_asc'' THEN private.rental_method_rank({rmethod}) WHEN ''return_method_desc'' THEN -private.rental_method_rank({rmethod}) END ASC, -- sort-843\n' ||
    E'      CASE WHEN p_sort IN (''pickup_method_asc'', ''pickup_method_desc'') THEN {start} WHEN p_sort IN (''return_method_asc'', ''return_method_desc'') THEN {end} END ASC NULLS LAST,\n' ||
    E'      CASE WHEN p_sort IN (''pickup_method_asc'', ''pickup_method_desc'') THEN private.rental_time_minutes({ptime}, 1440)\n' ||
    E'           WHEN p_sort IN (''return_method_asc'', ''return_method_desc'') THEN private.rental_time_minutes({rtime}, 1080) END ASC,\n' ||
    E'      CASE WHEN p_sort = ''delay_pickup_asc'' THEN CASE WHEN private.rental_pickup_due(';

  v_single := v_tpl;
  v_single := replace(v_single, '{pmethod}', 'rr.pickup_method');
  v_single := replace(v_single, '{rmethod}', 'rr.return_method');
  v_single := replace(v_single, '{start}', 'rr.start_date');
  v_single := replace(v_single, '{end}', 'rr.end_date');
  v_single := replace(v_single, '{ptime}', 'rr.pickup_time');
  v_single := replace(v_single, '{rtime}', 'rr.return_time');
  v_single := v_single || E'rr.start_date, rr.pickup_time) THEN 0 ELSE 1 END';

  v_group := v_tpl;
  v_group := replace(v_group, '{pmethod}', 'g.b_pickup_method');
  v_group := replace(v_group, '{rmethod}', 'g.b_return_method');
  v_group := replace(v_group, '{start}', 'g.b_rental_start');
  v_group := replace(v_group, '{end}', 'g.b_rental_end');
  v_group := replace(v_group, '{ptime}', 'g.b_pickup_time');
  v_group := replace(v_group, '{rtime}', 'g.b_return_time');
  v_group := v_group || E'g.b_rental_start, g.b_pickup_time) THEN 0 ELSE 1 END';

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_s, ''))) / length(v_anchor_s);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#843 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_s, v_single);

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_g, ''))) / length(v_anchor_g);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#843 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_g, v_group);

  EXECUTE v_new;
  -- CREATE OR REPLACE 는 권한을 유지하지만 명시적으로 다시 확인·설정
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) TO service_role;
END
$patch$;
