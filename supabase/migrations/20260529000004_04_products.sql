-- ★ MIGRATION: 04_products.sql
-- Schema version: v5.46
-- Description: M1 Products — product catalog master table
-- Dependencies: 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category     product_category_enum NOT NULL,
  name         VARCHAR(200) NOT NULL,
  slug         VARCHAR(200) NOT NULL UNIQUE,
  brand        VARCHAR(100),
  description  TEXT,
  image_urls   TEXT[] NOT NULL DEFAULT '{}',
  specifications JSONB,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX idx_products_category ON products(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_slug     ON products(slug)     WHERE deleted_at IS NULL;
CREATE INDEX idx_products_active   ON products(is_active) WHERE deleted_at IS NULL;

-- Full-text search index (pg_trgm)
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products: 전체 조회 허용" ON products
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "products: 관리자 전체" ON products
  FOR ALL USING (is_admin());

CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
