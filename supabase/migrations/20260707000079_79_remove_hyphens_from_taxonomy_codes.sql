-- Migration #79: 분류코드 하이픈 제거
-- 대상: product_category_codes.code (depth=1 서브카테고리 57개)
-- 예) ACC-BAG → ACCBAG, AUD-MIC → AUDMIC
-- path_codes 배열 + product_code_sequences.category_code 동기 갱신

-- ── 1. product_category_codes 갱신 ──────────────────────────────────────────
UPDATE product_category_codes
SET
  code        = REPLACE(code, '-', ''),
  path_codes  = ARRAY(
                  SELECT REPLACE(elem, '-', '')
                  FROM   unnest(path_codes) AS elem
                )
WHERE code LIKE '%-%'
  AND deleted_at IS NULL;

-- ── 2. product_code_sequences 카테고리 코드 동기 갱신 ───────────────────────
-- 하이픈 포함 코드로 채번된 시퀀스가 있으면 새 코드명으로 이어받음
UPDATE product_code_sequences
SET category_code = REPLACE(category_code, '-', '')
WHERE category_code LIKE '%-%';
