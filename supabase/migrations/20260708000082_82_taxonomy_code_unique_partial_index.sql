-- Migration #82: product_category_codes.code UNIQUE 제약 → 부분 인덱스로 교체
-- soft-delete된 코드와 동일한 코드 재사용 허용

-- 1. 기존 UNIQUE 제약 제거
ALTER TABLE product_category_codes
  DROP CONSTRAINT IF EXISTS product_category_codes_code_key;

-- 2. 활성 레코드(deleted_at IS NULL)에만 유니크 적용하는 부분 인덱스 추가
CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_code_unique_active
  ON product_category_codes (code)
  WHERE deleted_at IS NULL;
