-- Migration 654: 자식 재고의 부모 정보 "복사 → 참조" 전환 — Phase 2A (금액·정책 DB 함수 읽기 전환)
-- 2026-10-06 | 🔴 CRITICAL | Stephen 승인 플랜(partitioned-mapping-unicorn.md [B] Phase 2A)
--
-- 정책: 자식 재고(products.parent_product_id IS NOT NULL)는 sale_only·sale_price·category를
--       "부모 우선, 자식 폴백"(COALESCE(부모, 자식))으로 해석한다. 기존 자식 칼럼 값은 지우지 않는다.
--       (부모가 비활성·삭제여도 SECURITY DEFINER 함수라 부모 행을 읽을 수 있고, 부모가 없으면 자식 값 사용)
--
-- 방식: 함수 본문을 손으로 다시 쓰지 않고, 라이브 정의(pg_get_functiondef)에서 "정확히 한 번 일치하는 줄"만
--       치환해 CREATE OR REPLACE 한다 — 직전 정본과의 드리프트(같은 함수가 여러 번 재정의됨) 방지.
--       일치 횟수가 1이 아니면 예외로 전체 롤백. 이미 적용된 상태(guard 문자열 존재)면 건너뛴다(멱등).
--       CREATE OR REPLACE 는 기존 ACL·소유자·SET search_path 를 그대로 보존한다(시그니처·반환 형태 불변).
--
-- 변경 지점(7개 함수, 읽기 기준만 바뀜 — Production 기준 자식·부모 sale_only/sale_price/category 불일치 0건이라 값 중립):
--   1. compute_reservation_line_amount   : sale_only·sale_price 부모 우선
--   2. create_reservation_order          : PRICE_UNSET 검사의 sale_only 부모 우선
--   3. try_confirm_reservation           : 판매전용 즉시확정 판정 부모 우선
--   4. assert_reservation_lead_and_period: 판매전용이면 대여 마감 검사 생략 — 부모 우선
--   5. create_draft_reservation          : (자식 OR 부모) → 부모 우선 (자식이 true면 부모를 덮어쓰던 구조 제거)
--   6. private._validate_and_consume_coupon: 카테고리 쿠폰 대상 판정 부모 우선 (sale_only 판정부는 이미 부모 우선)
--   7. update_reservation_status         : 확정 시 판매전용 재고 즉시 비활성 판정 부모 우선
--
-- 롤백: 파일 맨 아래 주석의 ROLLBACK 블록(치환 반대 방향)을 실행한다.

CREATE FUNCTION pg_temp.cp_patch(def text, old text, new text, guard text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE cnt int;
BEGIN
  IF position(guard in def) > 0 THEN
    RETURN def;  -- 이미 적용됨(멱등)
  END IF;
  cnt := (length(def) - length(replace(def, old, ''))) / length(old);
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'cp_patch: 치환 대상 일치 횟수가 1이 아님(count=%): [%]', cnt, old;
  END IF;
  RETURN replace(def, old, new);
END;
$f$;

-- 1. compute_reservation_line_amount
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.compute_reservation_line_amount(bigint)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'SELECT COALESCE(sale_only, false), sale_price, COALESCE(parent_product_id, id)',
    'SELECT COALESCE(par.sale_only, p.sale_only, false), COALESCE(par.sale_price, p.sale_price), COALESCE(p.parent_product_id, p.id)',
    'COALESCE(par.sale_only, p.sale_only, false), COALESCE(par.sale_price');
  d := pg_temp.cp_patch(d,
    'FROM products WHERE id = r.product_id;',
    'FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = r.product_id;',
    'LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = r.product_id');
  EXECUTE d;
END $m$;

-- 2. create_reservation_order
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.create_reservation_order(uuid, bigint[], uuid, integer, integer, uuid[])'::regprocedure);
  d := pg_temp.cp_patch(d,
    'JOIN products pu ON pu.id = rr.product_id',
    E'JOIN products pu ON pu.id = rr.product_id\n    LEFT JOIN products pup ON pup.id = pu.parent_product_id',
    'LEFT JOIN products pup ON pup.id = pu.parent_product_id');
  d := pg_temp.cp_patch(d,
    'AND COALESCE(pu.sale_only, false) = false',
    'AND COALESCE(pup.sale_only, pu.sale_only, false) = false',
    'COALESCE(pup.sale_only, pu.sale_only, false) = false');
  EXECUTE d;
END $m$;

-- 3. try_confirm_reservation
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.try_confirm_reservation(bigint)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'SELECT COALESCE(sale_only, false) INTO v_is_sale FROM public.products WHERE id = v_product_id;',
    'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale FROM public.products p LEFT JOIN public.products par ON par.id = p.parent_product_id WHERE p.id = v_product_id;',
    'COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale');
  EXECUTE d;
END $m$;

-- 4. assert_reservation_lead_and_period
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.assert_reservation_lead_and_period(uuid, date, date, text)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'SELECT COALESCE(sale_only, false) INTO v_sale FROM products WHERE id = p_product_id;',
    'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_sale FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = p_product_id;',
    'COALESCE(par.sale_only, p.sale_only, false) INTO v_sale');
  EXECUTE d;
END $m$;

-- 5. create_draft_reservation
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.create_draft_reservation(uuid)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'SELECT (COALESCE(p.sale_only, false) OR COALESCE(par.sale_only, false))',
    'SELECT COALESCE(par.sale_only, p.sale_only, false)',
    'SELECT COALESCE(par.sale_only, p.sale_only, false)');
  EXECUTE d;
END $m$;

-- 6. private._validate_and_consume_coupon (카테고리 쿠폰 대상 판정)
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('private._validate_and_consume_coupon(uuid, bigint, uuid)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'JOIN products p ON p.id = rr.product_id',
    E'JOIN products p ON p.id = rr.product_id\n        LEFT JOIN products pp ON pp.id = p.parent_product_id',
    'LEFT JOIN products pp ON pp.id = p.parent_product_id');
  d := pg_temp.cp_patch(d,
    'AND p.category IN (SELECT',
    'AND COALESCE(pp.category, p.category) IN (SELECT',
    'COALESCE(pp.category, p.category) IN (SELECT');
  EXECUTE d;
END $m$;

-- 7. update_reservation_status (확정 시 판매전용 재고 즉시 비활성 판정)
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.update_reservation_status(bigint, text)'::regprocedure);
  d := pg_temp.cp_patch(d,
    'SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;',
    'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = v_product_id;',
    'COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale');
  EXECUTE d;
END $m$;

-- ============================================================================================
-- ROLLBACK (필요 시 별도 실행 — 위 cp_patch 함수를 먼저 생성한 뒤, 각 함수에서 new → old 방향으로 치환):
--   compute_reservation_line_amount  : 'SELECT COALESCE(par.sale_only, p.sale_only, false), COALESCE(par.sale_price, p.sale_price), COALESCE(p.parent_product_id, p.id)'
--                                       → 'SELECT COALESCE(sale_only, false), sale_price, COALESCE(parent_product_id, id)'
--                                      'FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = r.product_id;'
--                                       → 'FROM products WHERE id = r.product_id;'
--   create_reservation_order         : 'COALESCE(pup.sale_only, pu.sale_only, false) = false' → 'COALESCE(pu.sale_only, false) = false'
--                                      '\n    LEFT JOIN products pup ON pup.id = pu.parent_product_id' → ''
--   try_confirm_reservation          : 'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale FROM public.products p LEFT JOIN public.products par ON par.id = p.parent_product_id WHERE p.id = v_product_id;'
--                                       → 'SELECT COALESCE(sale_only, false) INTO v_is_sale FROM public.products WHERE id = v_product_id;'
--   assert_reservation_lead_and_period: 'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_sale FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = p_product_id;'
--                                       → 'SELECT COALESCE(sale_only, false) INTO v_sale FROM products WHERE id = p_product_id;'
--   create_draft_reservation         : 'SELECT COALESCE(par.sale_only, p.sale_only, false)' → 'SELECT (COALESCE(p.sale_only, false) OR COALESCE(par.sale_only, false))'
--   _validate_and_consume_coupon     : 'COALESCE(pp.category, p.category) IN (SELECT' → 'p.category IN (SELECT'
--                                      '\n        LEFT JOIN products pp ON pp.id = p.parent_product_id' → ''
--   update_reservation_status        : 'SELECT COALESCE(par.sale_only, p.sale_only, false) INTO v_is_sale FROM products p LEFT JOIN products par ON par.id = p.parent_product_id WHERE p.id = v_product_id;'
--                                       → 'SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;'
-- 주의: 롤백 시 guard 문자열(new 쪽)이 존재하므로 cp_patch 의 guard 인자를 old 쪽에 없는 임의 문자열로 바꿔 호출할 것.
-- ============================================================================================
