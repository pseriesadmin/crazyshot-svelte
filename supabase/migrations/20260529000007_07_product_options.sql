-- ★ MIGRATION: 07_product_options.sql
-- Schema version: v5.46
-- Description: M1 Products — add-on options (accessory, service, bundle)
-- Dependencies: 04_products.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS product_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_type    option_type_enum NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  price          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(price >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  is_required    BOOLEAN NOT NULL DEFAULT false,
  display_order  SMALLINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX idx_product_options_product ON product_options(product_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_options_type    ON product_options(option_type) WHERE deleted_at IS NULL;

ALTER TABLE product_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_options: 전체 조회 허용" ON product_options
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY "product_options: 관리자 전체" ON product_options
  FOR ALL USING (is_admin());

CREATE TRIGGER set_product_options_updated_at
  BEFORE UPDATE ON product_options
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
