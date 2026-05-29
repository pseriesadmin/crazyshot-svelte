-- ★ MIGRATION: 05_assets.sql
-- Schema version: v5.46
-- Description: M1 Products — physical asset inventory management
-- Dependencies: 04_products.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS assets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  asset_code               VARCHAR(50) NOT NULL UNIQUE,
  serial_number            VARCHAR(100),
  status                   asset_status_enum NOT NULL DEFAULT 'available',
  condition_notes          TEXT,
  purchase_date            DATE,
  last_maintenance_date    DATE,
  next_maintenance_date    DATE,
  maintenance_interval_days INT NOT NULL DEFAULT 180,
  is_insured               BOOLEAN NOT NULL DEFAULT false,
  insurance_provider       VARCHAR(100),
  insurance_policy_number  VARCHAR(100),
  warehouse_location       VARCHAR(100),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);

CREATE INDEX idx_assets_product_id ON assets(product_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_status     ON assets(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_code       ON assets(asset_code);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- Public: 조회 가능 (available 상태만)
CREATE POLICY "assets: 가용 자산 조회" ON assets
  FOR SELECT USING (status = 'available' AND deleted_at IS NULL);

CREATE POLICY "assets: 관리자 전체" ON assets
  FOR ALL USING (is_admin());

-- Authenticated users can view their rented assets
CREATE POLICY "assets: 본인 렌탈 자산 조회" ON assets
  FOR SELECT USING (
    deleted_at IS NULL AND
    EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.asset_id = assets.id
        AND rr.user_id = auth.uid()
        AND rr.status IN ('confirmed', 'in_use')
    )
  );

CREATE TRIGGER set_assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
