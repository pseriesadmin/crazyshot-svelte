-- Migration 661: 자식 재고의 부모 정보 "복사 → 참조" 전환 — Phase 5 (신규 재고 생성 시 부모 값 복사 중단, DB 함수 쪽)
-- 2026-10-07 | 🔴 CRITICAL | Stephen 승인 플랜(partitioned-mapping-unicorn.md [B] Phase 5), 결정 D3
--
-- 정책: 재고(자식)는 부모 정보를 복사해 저장하지 않고 참조한다(products.md §2-16). auto_create_inventory_for_product(상품 등록 직후 "기본 재고 1개" 자동 생성)가
--       자식 INSERT 때 부모의 brand·description·image_urls·specifications·components·keywords·content_blocks·sale_price·sale_only를 복사하던 것을 중단한다.
--       NOT NULL인 name·category(폴백 겸용)와 slug·is_active·qr_payload·parent_product_id만 넣는다. 나머지는 칼럼 기본값/NULL.
--       읽는 쪽은 Phase 2A·2B(#654·#658)·Phase 3에서 이미 전부 "부모 우선, 자식 폴백"이다.
-- 불변: 품번 채번(generate_inventory_product_code)·가격정책(price_rules) 복사·qr_payload 갱신·부모 검증·반환값·ACL·search_path·시그니처.
-- 방식: #654·#658과 같다 — 라이브 정의에서 예상 횟수만큼 일치하는 곳만 정규식 치환(불일치 시 롤백), 이미 적용됐으면 건너뜀(멱등).
-- 롤백: 아래 ROLLBACK 주석(원래 INSERT 블록으로 되돌림 — 이후 생성된 재고는 복사 값이 비어 있어도 읽기 경로가 부모 우선이므로 되돌릴 필요는 보통 없다).

CREATE FUNCTION pg_temp.cp_patch_re(def text, pattern text, repl text, expected int)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE cnt int;
BEGIN
  cnt := regexp_count(def, pattern);
  IF cnt <> expected THEN
    RAISE EXCEPTION 'cp_patch_re: 일치 횟수 불일치(expected=%, actual=%): [%]', expected, cnt, pattern;
  END IF;
  RETURN regexp_replace(def, pattern, repl, 'g');
END;
$f$;

DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.auto_create_inventory_for_product(uuid)'));
  IF position('v_parent.brand' in d) = 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d,
    'SELECT id, name, slug, category, brand, description,\s+image_urls, specifications, components, keywords,\s+content_blocks, sale_price, sale_only, code_series',
    'SELECT id, name, slug, category, code_series', 1);
  d := pg_temp.cp_patch_re(d,
    'INSERT INTO products \(\s*parent_product_id,.*?qr_payload\s*\) VALUES \(.*?NULL\s*\)\s*RETURNING id INTO v_child_id;',
    'INSERT INTO products (
    parent_product_id,
    name, slug, category, is_active, qr_payload
  ) VALUES (
    p_product_id,
    v_parent.name,
    v_parent.slug || ''-inv-'' || gen_random_uuid()::text,
    v_parent.category,
    true,
    NULL
  )
  RETURNING id INTO v_child_id;', 1);
  EXECUTE d;
END $m$;

-- ROLLBACK: pg_get_functiondef 결과에서 위 INSERT 블록·SELECT 목록을 원래(v_parent.brand 등 복사 포함)로 되돌리는 CREATE OR REPLACE를 실행한다.
--   원래 INSERT 칼럼: parent_product_id, name, slug, category, brand, description, image_urls, specifications, components, keywords,
--                     content_blocks, is_active, sale_price, sale_only, qr_payload (값은 v_parent.* 복사, is_active=true, qr_payload=NULL)
--   원래 SELECT 목록: id, name, slug, category, brand, description, image_urls, specifications, components, keywords, content_blocks, sale_price, sale_only, code_series
