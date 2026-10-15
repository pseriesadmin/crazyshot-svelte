-- Migration #714: get_rental_list 취소 목록 분리 필터 p_cancel_payment_scope (2026-10-15, Stephen 확정)
--
-- 배경: 예약현황(/cms/reservation) '취소' 칩과 대여현황(/cms/rentals) '취소·환불' 칩이 같은 취소 건을 섞어 보여 관리 혼선.
-- 분리 기준(결제완료 이력 = rental_reservations.payment_confirmed_at, 취소해도 지워지지 않음 — 되돌림 RPC #492/#499만 NULL로 되돌린다):
--   'paid'   → 결제완료 이력 있는 건(계약완료·결제완료 후 취소) = 대여현황 '취소·환불'
--   'unpaid' → 결제완료 이력 없는 건(예약신청·계약대기 단계 취소, 만료 포함) = 예약현황 '취소'
--   NULL     → 필터 없음(기존 동작)
-- 묶음(주문 단위) 모드는 주문 내 최대 결제완료 시각(g_paid_at)으로 판정한다(결제는 주문 단위).
--
-- 파라미터가 늘어 CREATE OR REPLACE 불가(새 오버로드가 생겨 PostgREST 모호성 발생) — 기존 시그니처 DROP 후 재생성.
-- 함수 본문은 라이브 정의에서 정확히 일치하는 줄만 치환한다(앵커가 없으면 중단, 이미 적용돼 있으면 건너뜀).
-- 롤백: p_cancel_payment_scope 파라미터와 두 조건 줄을 제거한 정의(Migration #712)로 DROP/CREATE 후 service_role 전용 권한 재설정.

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  s0 text := 'p_group_by_order boolean DEFAULT false';
  a1 text := E'      AND (p_exclude_statuses IS NULL OR NOT (rr.status = ANY(p_exclude_statuses)))\n';
  a2 text := E'      AND (p_exclude_statuses IS NULL OR NOT (g.g_status = ANY(p_exclude_statuses)))\n';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p
   WHERE p.proname = 'get_rental_list' AND p.pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_rental_list 없음'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('p_cancel_payment_scope' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, s0, ''))) <> length(s0)
     OR position(a1 IN v_def) = 0 OR position(a2 IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_rental_list 앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
  END IF;
  v_new := replace(v_def, s0, s0 || ', p_cancel_payment_scope text DEFAULT NULL::text');
  v_new := replace(v_new, a1, a1 ||
    E'      -- 취소 목록 분리(#714): 결제완료 이력 유무\n      AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (rr.payment_confirmed_at IS NOT NULL))\n');
  v_new := replace(v_new, a2, a2 ||
    E'      -- 취소 목록 분리(#714): 주문 내 결제완료 이력 유무\n      AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (g.g_paid_at IS NOT NULL))\n');
  DROP FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean);
  EXECUTE v_new;
END $$;

-- 권한: 서버(service_role) 전용 — DROP/CREATE로 초기화된 기본 ACL(anon·authenticated 포함)을 명시적으로 회수한다.
REVOKE ALL ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean,text) TO service_role;
