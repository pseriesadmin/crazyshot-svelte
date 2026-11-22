-- #844 예약대여현황 모든 컬럼 헤더 정렬 키 추가 (2026-11-20, Stephen 지시: 표 헤더 모든 컬럼에 정렬)
--   p_sort 에 추가: code_asc/desc(예약번호) · customer_asc/desc(고객명) · product_asc/desc(상품명) · pcode_asc/desc(상품코드)
--                   amount_asc/desc(결제금액) · contract_asc/desc(계약 상태: 미발행 0 < 미서명 1 < 발송중 2 < 서명완료 3)
--                   start_desc(대여 시작일 먼 순) · end_desc(반납 예정일 먼 순)
--   #843 이 끼운 ORDER BY 맨 앞에 항목만 추가(라이브 정의 앵커 치환, 시그니처 불변 → CREATE OR REPLACE). 같은 값은 신청일 최신순으로 이어진다.
-- ROLLBACK: get_rental_list 의 'sort-844' 줄(두 곳)과 그 아래 새 항목을 제거해 재생성.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_tpl text;
  v_single text;
  v_group text;
  v_anchor_s text := E'    ORDER BY\n      CASE p_sort WHEN ''pickup_method_asc'' THEN private.rental_method_rank(rr.pickup_method)';
  v_anchor_g text := E'    ORDER BY\n      CASE p_sort WHEN ''pickup_method_asc'' THEN private.rental_method_rank(g.b_pickup_method)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('sort-843' in v_def) = 0 THEN RAISE EXCEPTION '#844 requires #843'; END IF;
  IF position('sort-844' in v_def) > 0 THEN
    RAISE NOTICE '#844 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  v_tpl :=
    E'    ORDER BY\n' ||
    E'      CASE p_sort WHEN ''code_asc'' THEN {code} WHEN ''customer_asc'' THEN {customer} WHEN ''product_asc'' THEN {product} WHEN ''pcode_asc'' THEN {pcode} END ASC NULLS LAST, -- sort-844\n' ||
    E'      CASE p_sort WHEN ''code_desc'' THEN {code} WHEN ''customer_desc'' THEN {customer} WHEN ''product_desc'' THEN {product} WHEN ''pcode_desc'' THEN {pcode} END DESC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''amount_asc'' THEN {amount} END ASC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''amount_desc'' THEN {amount} END DESC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''contract_asc'' THEN {crank} END ASC,\n' ||
    E'      CASE p_sort WHEN ''contract_desc'' THEN {crank} END DESC,\n' ||
    E'      CASE p_sort WHEN ''start_desc'' THEN {start} END DESC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''end_desc'' THEN {end} END DESC NULLS LAST,\n' ||
    E'      CASE p_sort WHEN ''pickup_method_asc'' THEN private.rental_method_rank(';

  v_single := v_tpl;
  v_single := replace(v_single, '{code}', 'rr.reservation_code');
  v_single := replace(v_single, '{customer}', 'up.full_name');
  v_single := replace(v_single, '{product}', 'COALESCE(ppar.name, p.name)');
  v_single := replace(v_single, '{pcode}', 'p.product_code::TEXT');
  v_single := replace(v_single, '{amount}', 'o.final_amount');
  v_single := replace(v_single, '{crank}', 'CASE WHEN cs.signed_at IS NOT NULL THEN 3 WHEN cs.sent_at IS NOT NULL THEN 2 WHEN c.id IS NOT NULL THEN 1 ELSE 0 END');
  v_single := replace(v_single, '{start}', 'rr.start_date');
  v_single := replace(v_single, '{end}', 'rr.end_date');
  v_single := v_single || E'rr.pickup_method)';

  v_group := v_tpl;
  v_group := replace(v_group, '{code}', 'g.b_reservation_code');
  v_group := replace(v_group, '{customer}', 'g.b_customer_name');
  v_group := replace(v_group, '{product}', 'g.b_product_name');
  v_group := replace(v_group, '{pcode}', 'g.b_product_code');
  v_group := replace(v_group, '{amount}', 'g.b_order_amount');
  v_group := replace(v_group, '{crank}', 'CASE WHEN g.b_customer_signed_at IS NOT NULL THEN 3 WHEN g.b_signing_sent_at IS NOT NULL THEN 2 WHEN g.b_contract_id IS NOT NULL THEN 1 ELSE 0 END');
  v_group := replace(v_group, '{start}', 'g.b_rental_start');
  v_group := replace(v_group, '{end}', 'g.b_rental_end');
  v_group := v_group || E'g.b_pickup_method)';

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_s, ''))) / length(v_anchor_s);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#844 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_s, v_single);

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_g, ''))) / length(v_anchor_g);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#844 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_g, v_group);

  EXECUTE v_new;
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) TO service_role;
END
$patch$;
