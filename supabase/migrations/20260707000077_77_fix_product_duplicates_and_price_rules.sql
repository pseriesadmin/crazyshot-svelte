-- Migration #77: 중복 상품 정리 + price_rules UNIQUE 제약 수정
-- 목적 1: migration 61 이전 테스트 데이터에서 발생한 "Sony FX6-12" 3중 중복 해소
--         → 이미지 5장, 현재 사용 중인 98f44cf6 보존 / 나머지 2개 soft-delete
-- 목적 2: price_rules UNIQUE(product_id, duration_type) → deleted_at 제외 partial index로 교체
--         → soft-delete 후 재INSERT 시 UNIQUE 위반 방지

-- ============================================================
-- STEP 1: 삭제 대상 상품의 price_rules soft-delete
-- ============================================================
UPDATE price_rules
SET deleted_at = NOW(), is_active = false
WHERE product_id IN (
  '232b4eba-cfc2-4ecd-9d26-30462135dbed',
  '7f8fbb87-a273-4382-8620-360ce5522da4'
)
AND deleted_at IS NULL;

-- ============================================================
-- STEP 2: 삭제 대상 상품의 assets soft-delete
-- ============================================================
UPDATE assets
SET deleted_at = NOW()
WHERE product_id IN (
  '232b4eba-cfc2-4ecd-9d26-30462135dbed',
  '7f8fbb87-a273-4382-8620-360ce5522da4'
)
AND deleted_at IS NULL;

-- ============================================================
-- STEP 3: 중복 상품 2개 soft-delete
-- ============================================================
UPDATE products
SET deleted_at = NOW(), is_active = false
WHERE id IN (
  '232b4eba-cfc2-4ecd-9d26-30462135dbed',
  '7f8fbb87-a273-4382-8620-360ce5522da4'
)
AND deleted_at IS NULL;

-- ============================================================
-- STEP 4: price_rules UNIQUE 제약 → partial unique index 교체
-- 기존: UNIQUE(product_id, duration_type)  — soft-deleted 행 포함
-- 변경: partial unique index WHERE deleted_at IS NULL — active 행만 제약
-- ============================================================

-- 기존 UNIQUE 제약 삭제 (migration 61에서 생성됨)
ALTER TABLE price_rules
  DROP CONSTRAINT IF EXISTS price_rules_product_id_duration_type_key;

-- active 행에만 적용되는 partial unique index 생성
CREATE UNIQUE INDEX IF NOT EXISTS price_rules_active_unique
  ON price_rules (product_id, duration_type)
  WHERE deleted_at IS NULL;

-- ============================================================
-- ROLLBACK (수동 실행 시)
-- ============================================================
-- DROP INDEX IF EXISTS price_rules_active_unique;
-- ALTER TABLE price_rules
--   ADD CONSTRAINT price_rules_product_id_duration_type_key
--   UNIQUE (product_id, duration_type);
-- -- 중복 상품 복구는 별도 복원 필요 (soft-delete → deleted_at = NULL, is_active = true)
