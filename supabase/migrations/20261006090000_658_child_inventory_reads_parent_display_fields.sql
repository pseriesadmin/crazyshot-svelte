-- Migration 658: 자식 재고의 부모 정보 "복사 → 참조" 전환 — Phase 2B (표시·알림·목록 DB 함수 읽기 전환)
-- 2026-10-06 | 🟡 BOUNDARY | Stephen 승인 플랜(partitioned-mapping-unicorn.md [B] Phase 2B) — 결정 D1(부모의 현재 이름)·D4(검색은 부모·자식 이름 둘 다)
--
-- 정책: 자식 재고(products.parent_product_id IS NOT NULL)의 이름·분류·대표 이미지는 "부모 우선, 자식 폴백"으로 표시한다.
--       이름·분류는 NOT NULL 칼럼이라 COALESCE(부모, 자식), 이미지는 부모 배열이 비어 있으면 자식 이미지로 폴백한다.
--       product_code·QR·재고 상태 등 자식 고유값은 그대로 자식 값을 쓴다. 기존 자식 칼럼 값은 지우지 않는다.
--
-- 방식: #654와 같다 — 라이브 정의(pg_get_functiondef)에서 "예상 횟수만큼 일치하는 곳"만 정규식으로 치환해 CREATE OR REPLACE.
--       일치 횟수가 예상과 다르면 예외로 전체 롤백, 이미 적용됐으면(guard 존재) 건너뜀(멱등). ACL·SECURITY DEFINER·search_path·시그니처 보존.
--       별칭 ppar(부모)는 대상 함수에서 쓰이지 않음을 확인했다(get_rental_list의 pp1·pp2는 픽업지점).
--
-- 대상(5개 함수):
--   1. get_rental_list                        : 이름·분류·이미지(일반·주문묶음 두 분기) + 검색(부모 이름 OR 자식 이름)
--   2. send_rental_chat_notification          : 알림 카드의 상품명(발송 시점 부모 이름 — 이미 발송된 카드는 불변)
--   3. send_rental_chat_notification_batch    : 묶음 알림 상품명
--   4. get_return_remind_targets              : 반납 안내 대상의 상품명
--   5. claim_reservations_due_for_locker_guide: 무인보관함 안내 상품명(2곳)
-- 제외: get_active_rentals — 앱 어디에서도 호출하지 않는 함수이며 Stage·Production 정의가 서로 달라 이번 범위에서 제외(별건).
--
-- 롤백: 파일 맨 아래 주석 참고.

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

-- 1. get_rental_list
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean)'));
  IF position('ppar' in d) > 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d, '\mp\.name(\s+)AS product_name,',
         'COALESCE(ppar.name, p.name)\1AS product_name,', 1);
  d := pg_temp.cp_patch_re(d, '\mp\.category(\s+)AS product_category,',
         'COALESCE(ppar.category, p.category)\1AS product_category,', 1);
  d := pg_temp.cp_patch_re(d, '\(p\.image_urls ->> 0\)(\s+)AS product_image_url,',
         '(COALESCE(NULLIF(ppar.image_urls, ''[]''::jsonb), p.image_urls) ->> 0)\1AS product_image_url,', 1);
  d := pg_temp.cp_patch_re(d, '\mp\.name(\s+)AS b_product_name,',
         'COALESCE(ppar.name, p.name)\1AS b_product_name,', 1);
  d := pg_temp.cp_patch_re(d, '\mp\.category(\s+)AS b_product_category,',
         'COALESCE(ppar.category, p.category)\1AS b_product_category,', 1);
  d := pg_temp.cp_patch_re(d, '\(p\.image_urls ->> 0\)(\s+)AS b_product_image_url,',
         '(COALESCE(NULLIF(ppar.image_urls, ''[]''::jsonb), p.image_urls) ->> 0)\1AS b_product_image_url,', 1);
  d := pg_temp.cp_patch_re(d, 'JOIN products p ON p\.id = rr\.product_id',
         'JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id', 2);
  d := pg_temp.cp_patch_re(d, '\mp\.name(\s+)ILIKE ''%'' \|\| p_search \|\| ''%''',
         '(p.name ILIKE ''%'' || p_search || ''%'' OR ppar.name ILIKE ''%'' || p_search || ''%'')', 2);
  EXECUTE d;
END $m$;

-- 2. send_rental_chat_notification
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.send_rental_chat_notification(bigint, text, text)'));
  IF position('ppar' in d) > 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d, '(\n\s+)\mp\.name,(\n\s+rr\.end_date::DATE,)',
         '\1COALESCE(ppar.name, p.name),\2', 1);
  d := pg_temp.cp_patch_re(d, 'JOIN products p ON p\.id = rr\.product_id',
         'JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id', 1);
  EXECUTE d;
END $m$;

-- 3. send_rental_chat_notification_batch
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.send_rental_chat_notification_batch(bigint[], text)'));
  IF position('ppar' in d) > 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d, '\mp\.name AS product_name,',
         'COALESCE(ppar.name, p.name) AS product_name,', 1);
  d := pg_temp.cp_patch_re(d, 'JOIN products p ON p\.id = rr\.product_id',
         'JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id', 1);
  EXECUTE d;
END $m$;

-- 4. get_return_remind_targets
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.get_return_remind_targets(integer)'));
  IF position('ppar' in d) > 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d, '\mp\.name(\s+)AS product_name',
         'COALESCE(ppar.name, p.name)\1AS product_name', 1);
  d := pg_temp.cp_patch_re(d, '(LEFT JOIN products\s+p\s+ON p\.id\s+= rr\.product_id)',
         '\1 LEFT JOIN products ppar ON ppar.id = p.parent_product_id', 1);
  EXECUTE d;
END $m$;

-- 5. claim_reservations_due_for_locker_guide
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public.claim_reservations_due_for_locker_guide(integer)'));
  IF position('ppar' in d) > 0 THEN RETURN; END IF; -- 이미 적용됨(멱등)
  d := pg_temp.cp_patch_re(d, '\(SELECT p\.name FROM products p WHERE p\.id = rr\.product_id\)',
         '(SELECT COALESCE(ppar.name, p.name) FROM products p LEFT JOIN products ppar ON ppar.id = p.parent_product_id WHERE p.id = rr.product_id)', 2);
  EXECUTE d;
END $m$;

-- ============================================================================================
-- ROLLBACK: 각 함수에서 위 치환의 반대 방향으로 되돌린다(cp_patch_re를 만든 뒤, guard에는 new 쪽에 없는 임의 문자열을 넣어 호출):
--   COALESCE(ppar.name, p.name) → p.name / COALESCE(ppar.category, p.category) → p.category /
--   (COALESCE(NULLIF(ppar.image_urls, '[]'::jsonb), p.image_urls) ->> 0) → (p.image_urls ->> 0) /
--   ' LEFT JOIN products ppar ON ppar.id = p.parent_product_id' → '' /
--   '(p.name ILIKE ... OR ppar.name ILIKE ...)' → 'p.name ILIKE ...' (get_rental_list 검색 2곳)
-- ============================================================================================
