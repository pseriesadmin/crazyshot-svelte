-- ★ MIGRATION: 41_product_category_codes.sql
-- Description: CMS — 상품 분류코드 관리 + 예약코드 형식 설정
-- Dependencies: 04_products.sql, 34_admin_cms_rls.sql

-- ─── 1. 상품 분류코드 테이블 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_category_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(10) NOT NULL UNIQUE,   -- e.g., CAM, LNS, DRONE
  name            TEXT NOT NULL,                  -- e.g., 카메라, 렌즈
  product_category TEXT,                          -- links to ProductCategoryEnum (nullable)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_product_category_codes_active
  ON product_category_codes(is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE product_category_codes ENABLE ROW LEVEL SECURITY;

-- CMS 관리자만 접근
CREATE POLICY "product_category_codes: cms only"
  ON product_category_codes
  FOR ALL
  USING (is_cms_user());

-- ─── 2. CMS 설정 테이블 (예약코드 형식 등 key-value) ──────────────
CREATE TABLE IF NOT EXISTS cms_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cms_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cms_settings: cms only"
  ON cms_settings
  FOR ALL
  USING (is_cms_user());

-- ─── 3. 기본 분류코드 시드 (9개 카테고리) ──────────────────────────
INSERT INTO product_category_codes (code, name, product_category, sort_order) VALUES
  ('CAM',   '카메라',   'camera',     1),
  ('LNS',   '렌즈',     'lens',       2),
  ('CAM-C', '캠코더',   'camcorder',  3),
  ('ACT',   '액션캠',   'action_cam', 4),
  ('DRN',   '드론',     'drone',      5),
  ('LGT',   '조명',     'lighting',   6),
  ('AUD',   '오디오',   'audio',      7),
  ('ACC',   '보조용품', 'accessory',  8),
  ('PKG',   '패키지',   'package',    9)
ON CONFLICT (code) DO NOTHING;

-- ─── 4. 기본 예약코드 형식 설정 ────────────────────────────────────
INSERT INTO cms_settings (key, value) VALUES
  ('reservation_code_format', '{
    "prefix": "CS",
    "separator": "-",
    "date_format": "YYMM",
    "seq_digits": 3,
    "preview": "CS-CAM-2607-001"
  }')
ON CONFLICT (key) DO NOTHING;
