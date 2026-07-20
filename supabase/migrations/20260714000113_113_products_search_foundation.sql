-- Migration 113: products 통합 검색 기반 (FTS + trgm)
-- 근거: products.name ILIKE 검색에 인덱스 없음. 10K 상품에서 full table scan.
--       한국어 FTS는 'simple' config(공백 토크나이저) 사용 — stemming 없음, 안전.
--       pg_trgm은 Migration 01에서 이미 활성화됨.

-- 1. search_vector 컬럼 추가 (tsvector — AI 학습 기반 랭킹 입력값)
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. search_vector 자동 갱신 트리거 함수
--    가중치: name(A) > brand(B) > slug(B) > description(C) > category(D)
CREATE OR REPLACE FUNCTION products_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.slug, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.category, '')), 'D');
  RETURN NEW;
END;
$$;

-- 3. 트리거 등록 (INSERT·UPDATE 시 자동 재계산)
DROP TRIGGER IF EXISTS trig_products_search_vector ON products;
CREATE TRIGGER trig_products_search_vector
  BEFORE INSERT OR UPDATE OF name, brand, slug, description, category
  ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- 4. 기존 rows 백필 (10K 상품 기준 ~5초, 락 없음)
UPDATE products
SET search_vector =
  setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(slug, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(description, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(category, '')), 'D')
WHERE deleted_at IS NULL;

-- 5. GIN 인덱스 — FTS 검색 (CONCURRENTLY: 락 없이 생성)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_search_vector
  ON products USING GIN(search_vector)
  WHERE deleted_at IS NULL;

-- 6. trgm 인덱스 — ILIKE 검색 (CMS products 검색 즉시 개선, 코드 변경 없이)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN(name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- 7. brand trgm (브랜드명 검색 지원)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_brand_trgm
  ON products USING GIN(brand gin_trgm_ops)
  WHERE deleted_at IS NULL AND brand IS NOT NULL;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- DROP INDEX CONCURRENTLY IF EXISTS idx_products_brand_trgm;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_products_name_trgm;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_products_search_vector;
-- DROP TRIGGER IF EXISTS trig_products_search_vector ON products;
-- DROP FUNCTION IF EXISTS products_search_vector_update();
-- ALTER TABLE products DROP COLUMN IF EXISTS search_vector;
-- ============================================================
