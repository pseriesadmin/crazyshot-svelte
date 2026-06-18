-- ★ MIGRATION: 06_price_rules.sql
-- Schema version: v5.46
-- Description: M1 Products — pricing rules per product and duration type
-- Dependencies: 04_products.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS price_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  duration_type         duration_type_enum NOT NULL,
  price                 NUMERIC(10,2) NOT NULL CHECK(price >= 0),
  deposit_amount        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(deposit_amount >= 0),
  late_fee_per_hour     NUMERIC(10,2) NOT NULL DEFAULT 0,
  damage_fee_percentage NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK(damage_fee_percentage BETWEEN 0 AND 100),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  effective_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  -- 한 상품에 동일 duration_type은 유효기간 내 1개만 허용
  CONSTRAINT price_rules_product_duration_unique
    EXCLUDE USING gist (
      product_id WITH =,
      duration_type WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity')) WITH &&
    ) WHERE (deleted_at IS NULL)
);

CREATE INDEX idx_price_rules_product   ON price_rules(product_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_price_rules_active    ON price_rules(is_active, effective_from, effective_to)
  WHERE deleted_at IS NULL;

ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_rules: 전체 조회 허용" ON price_rules
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "price_rules: 관리자 전체" ON price_rules
  FOR ALL USING (is_admin());

CREATE TRIGGER set_price_rules_updated_at
  BEFORE UPDATE ON price_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
