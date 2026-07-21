-- ★ MIGRATION: 126_rental_settings_tables.sql
-- Description: /cms/set/ 대여관리 설정 — 대여기간·대여방식·지점·이용안내 테이블
-- Dependencies: 08_pickup_points.sql, 34_is_cms_user
-- Author: Stephen Cconzy
-- Date: 2026-07-21

-- 1. pickup_points 담당자 컬럼 추가
ALTER TABLE pickup_points
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(10);

-- 2. 대여 기간 조건 (최대 10개 — RPC 레벨 제한)
CREATE TABLE IF NOT EXISTS rental_period_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(50) NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_rental_period_options_active
  ON rental_period_options(display_order)
  WHERE deleted_at IS NULL;

ALTER TABLE rental_period_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_period_options: 공개 조회"
  ON rental_period_options FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "rental_period_options: 관리자 전체"
  ON rental_period_options FOR ALL
  USING (is_admin());

CREATE TRIGGER set_rental_period_options_updated_at
  BEFORE UPDATE ON rental_period_options
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 3. 대여 방식 (최대 10개 — RPC 레벨 제한)
CREATE TABLE IF NOT EXISTS rental_method_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(50) NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_rental_method_options_active
  ON rental_method_options(display_order)
  WHERE deleted_at IS NULL;

ALTER TABLE rental_method_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_method_options: 공개 조회"
  ON rental_method_options FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "rental_method_options: 관리자 전체"
  ON rental_method_options FOR ALL
  USING (is_admin());

CREATE TRIGGER set_rental_method_options_updated_at
  BEFORE UPDATE ON rental_method_options
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 4. 공통 대여 안내문 싱글톤 (1행 고정)
CREATE TABLE IF NOT EXISTS rental_guide_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_text TEXT,
  CONSTRAINT rental_guide_text_len CHECK (length(guide_text) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rental_guide_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_guide_settings: 공개 조회"
  ON rental_guide_settings FOR SELECT
  USING (true);

CREATE POLICY "rental_guide_settings: 관리자 전체"
  ON rental_guide_settings FOR ALL
  USING (is_admin());

CREATE TRIGGER set_rental_guide_settings_updated_at
  BEFORE UPDATE ON rental_guide_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 싱글톤 초기 행 삽입
INSERT INTO rental_guide_settings (guide_text) VALUES ('') ON CONFLICT DO NOTHING;

-- 5. 필수 동의문 항목 (최대 10개 — RPC 레벨 제한)
CREATE TABLE IF NOT EXISTS rental_consent_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content       VARCHAR(200) NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_rental_consent_items_active
  ON rental_consent_items(display_order)
  WHERE deleted_at IS NULL;

ALTER TABLE rental_consent_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_consent_items: 공개 조회"
  ON rental_consent_items FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "rental_consent_items: 관리자 전체"
  ON rental_consent_items FOR ALL
  USING (is_admin());

CREATE TRIGGER set_rental_consent_items_updated_at
  BEFORE UPDATE ON rental_consent_items
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ROLLBACK (수동 실행):
-- DROP TABLE IF EXISTS rental_consent_items;
-- DROP TABLE IF EXISTS rental_guide_settings;
-- DROP TABLE IF EXISTS rental_method_options;
-- DROP TABLE IF EXISTS rental_period_options;
-- ALTER TABLE pickup_points DROP COLUMN IF EXISTS contact_person;
