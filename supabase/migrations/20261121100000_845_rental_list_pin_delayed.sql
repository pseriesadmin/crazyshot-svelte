-- #845 배송중 탭 '지연건 최상단 고정' (2026-11-21, CSV 비고) — 어떤 컬럼으로 정렬해도 수령 예정일시가 지난 건이 맨 위에 온다.
--   p_sort 가 'pin:' 으로 시작하면(예: 'pin:customer_asc') 접두어를 떼고 그 정렬을 적용하되, 수령 지연 건(private.rental_pickup_due)을 항상 앞에 둔다.
--   시그니처 불변(CREATE OR REPLACE) — 기존 호출자·p_sort 값은 영향 없음. #844 가 만든 get_rental_list 에 앵커 치환.
-- ROLLBACK: get_rental_list 의 'sort-845' 줄과 DECLARE v_pin 블록을 제거해 재생성.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_anchor_begin text := E'AS $function$\nBEGIN\n  IF NOT COALESCE(p_group_by_order, false) THEN';
  v_anchor_s text := E'    ORDER BY\n      CASE p_sort WHEN ''code_asc'' THEN rr.reservation_code';
  v_anchor_g text := E'    ORDER BY\n      CASE p_sort WHEN ''code_asc'' THEN g.b_reservation_code';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('sort-844' in v_def) = 0 THEN RAISE EXCEPTION '#845 requires #844'; END IF;
  IF position('sort-845' in v_def) > 0 THEN
    RAISE NOTICE '#845 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_begin, ''))) / length(v_anchor_begin);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#845 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_begin,
    E'AS $function$\nDECLARE\n  v_pin boolean := COALESCE(p_sort LIKE ''pin:%'', false); -- sort-845\nBEGIN\n  IF v_pin THEN p_sort := substr(p_sort, 5); END IF;\n  IF NOT COALESCE(p_group_by_order, false) THEN');

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_s, ''))) / length(v_anchor_s);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#845 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_s,
    E'    ORDER BY\n      CASE WHEN v_pin THEN CASE WHEN private.rental_pickup_due(rr.start_date, rr.pickup_time) THEN 0 ELSE 1 END END ASC,\n      CASE p_sort WHEN ''code_asc'' THEN rr.reservation_code');

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_g, ''))) / length(v_anchor_g);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#845 patch3 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_g,
    E'    ORDER BY\n      CASE WHEN v_pin THEN CASE WHEN private.rental_pickup_due(g.b_rental_start, g.b_pickup_time) THEN 0 ELSE 1 END END ASC,\n      CASE p_sort WHEN ''code_asc'' THEN g.b_reservation_code');

  EXECUTE v_new;
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) TO service_role;
END
$patch$;
