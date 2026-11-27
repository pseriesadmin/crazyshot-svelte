-- #860 get_rental_list 날짜 구간 '겹침' 모드 추가 (2026-11-27, Stephen 확정 — CMS 홈 간트에 종료된 대여예약 바까지 모두 노출)
--   배경: 날짜 조건이 '시작일 ≥ 구간 시작 AND 종료일 ≤ 구간 끝'(구간 안에 완전히 포함)이라, 구간 경계에 걸친 예약
--         (예: 6일 전 시작·2일 전 종료, 구간 -3일~+10일)이 첫 로드에도 과거 스크롤 구간에도 안 나왔다.
--   변경: 끝에 선택 인자 p_date_overlap boolean DEFAULT false 추가.
--         false(기본) = 기존 동작 그대로(예약대여현황·예약현황·모바일 날짜 필터 무영향)
--         true        = 구간과 겹치는 예약('종료일 ≥ 구간 시작 AND 시작일 ≤ 구간 끝') — 간트만 사용.
--   시그니처가 바뀌므로 #842 와 같이 새 함수를 만든 뒤 옛 시그니처를 DROP 하고 service_role 전용으로 다시 GRANT 한다.
--   라이브 정의를 읽어 앵커 치환(#842·#846 방식) — 적용 전에 다른 변경이 있어도 그 위에 얹힌다.
-- ROLLBACK: p_date_overlap 인자와 'overlap-860' 표시·CASE WHEN p_date_overlap 분기를 제거한 정의로 재생성하고(18개 인자 시그니처),
--           19개 인자 시그니처를 DROP 한 뒤 service_role 만 GRANT. 호출부(간트 2곳)는 p_date_overlap 를 빼야 한다.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_from_old text := 'p_date_from IS NULL OR rr.start_date >= p_date_from';
  v_from_new text := 'p_date_from IS NULL OR CASE WHEN p_date_overlap THEN rr.end_date >= p_date_from ELSE rr.start_date >= p_date_from END';
  v_to_s_old text := 'p_date_to   IS NULL OR rr.end_date   <= p_date_to';
  v_to_g_old text := 'p_date_to IS NULL OR rr.end_date <= p_date_to';
  v_to_new text := 'p_date_to IS NULL OR CASE WHEN p_date_overlap THEN rr.start_date <= p_date_to ELSE rr.end_date <= p_date_to END';
  v_sig_old text := 'p_payment_stage text DEFAULT NULL::text)';
  v_sig_new text := 'p_payment_stage text DEFAULT NULL::text, p_date_overlap boolean DEFAULT false)';
  v_mark_old text := E'-- sort-845\n';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list'
     AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_date_overlap%';
  IF v_def IS NULL THEN
    RAISE NOTICE '#860 get_rental_list 이미 패치됨(또는 옛 시그니처 없음) — 건너뜀';
    RETURN;
  END IF;
  IF position('sort-845' in v_def) = 0 THEN RAISE EXCEPTION '#860 requires #845'; END IF;
  v_new := v_def;

  v_cnt := (length(v_new) - length(replace(v_new, v_sig_old, ''))) / length(v_sig_old);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#860 시그니처 앵커 불일치 (%)', v_cnt; END IF;
  v_new := replace(v_new, v_sig_old, v_sig_new);

  v_cnt := (length(v_new) - length(replace(v_new, v_from_old, ''))) / length(v_from_old);
  IF v_cnt <> 2 THEN RAISE EXCEPTION '#860 시작일 조건 앵커 불일치 (% — 기대 2: 단건·묶음)', v_cnt; END IF;
  v_new := replace(v_new, v_from_old, v_from_new);

  v_cnt := (length(v_new) - length(replace(v_new, v_to_s_old, ''))) / length(v_to_s_old);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#860 종료일(단건) 앵커 불일치 (%)', v_cnt; END IF;
  v_new := replace(v_new, v_to_s_old, v_to_new);

  v_cnt := (length(v_new) - length(replace(v_new, v_to_g_old, ''))) / length(v_to_g_old);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#860 종료일(묶음) 앵커 불일치 (%)', v_cnt; END IF;
  v_new := replace(v_new, v_to_g_old, v_to_new);

  v_cnt := (length(v_new) - length(replace(v_new, v_mark_old, ''))) / length(v_mark_old);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#860 표시 앵커 불일치 (%)', v_cnt; END IF;
  v_new := replace(v_new, v_mark_old, E'-- sort-845 overlap-860\n');

  EXECUTE v_new;
  DROP FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text);
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text, boolean) TO service_role;
END
$patch$;
