-- ★ MIGRATION: 08_pickup_points.sql
-- Schema version: v5.46
-- Description: M1 Products — physical pickup/return locations (로커 등)
-- Dependencies: 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS pickup_points (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  location         VARCHAR(200) NOT NULL,
  address          TEXT NOT NULL,
  phone            VARCHAR(20),
  operating_hours  JSONB,          -- {"mon":{"open":"09:00","close":"18:00"}, ...}
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_pickup_points_active ON pickup_points(is_active) WHERE deleted_at IS NULL;

ALTER TABLE pickup_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pickup_points: 전체 조회 허용" ON pickup_points
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "pickup_points: 관리자 전체" ON pickup_points
  FOR ALL USING (is_admin());

CREATE TRIGGER set_pickup_points_updated_at
  BEFORE UPDATE ON pickup_points
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
