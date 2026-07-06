-- Migration #70: category_taxonomy_map 기본 매핑 입력
-- depth=0 활성 분류코드 전체에 대해 product_category → taxonomy_code_id 매핑 자동 생성
--
-- 매핑 기준:
--   product_category 컬럼이 있는 경우 → 그 값 사용 (예: CAM → 'camera')
--   product_category = NULL인 경우  → LOWER(code) 사용 (예: SPT → 'spt')
--
-- 영향 범위: category_taxonomy_map 테이블 (INSERT ONLY, 기존 rows 미변경)
-- 적용 후 효과: generate_product_code RPC Step 1 (taxonomy_map 조회)이 모든 카테고리에서 동작

INSERT INTO category_taxonomy_map (product_category, taxonomy_code_id, priority, is_auto)
SELECT
  COALESCE(pc.product_category, LOWER(pc.code)) AS product_category,
  pc.id                                          AS taxonomy_code_id,
  1                                              AS priority,
  true                                           AS is_auto
FROM product_category_codes pc
WHERE pc.depth      = 0
  AND pc.deleted_at IS NULL
  AND pc.is_active  = true
ON CONFLICT (product_category, taxonomy_code_id) DO NOTHING;

-- ROLLBACK:
-- DELETE FROM category_taxonomy_map
-- WHERE is_auto = true AND priority = 1
--   AND taxonomy_code_id IN (
--     SELECT id FROM product_category_codes WHERE depth = 0 AND deleted_at IS NULL
--   );
