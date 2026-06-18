-- ★ MIGRATION: 15_coupons.sql
-- Schema version: v5.46
-- Description: M4 Membership — coupon definition and management
-- Dependencies: 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- Coupon types (§13 §5 discount order — step 3):
--   all           — 일반 쿠폰
--   first_purchase — 첫 구매 쿠폰
--   student       — 학생 쿠폰
--   subscription  — 구독 쿠폰

CREATE TABLE IF NOT EXISTS coupons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(50) NOT NULL UNIQUE,
  type                coupon_type_enum NOT NULL,
  discount_type       VARCHAR(15) NOT NULL CHECK(discount_type IN ('fixed', 'percentage')),
  discount_value      NUMERIC(10,2) NOT NULL CHECK(discount_value > 0),
  max_discount_amount NUMERIC(10,2),             -- percentage 쿠폰의 최대 할인 캡
  min_purchase_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  usage_limit         INT NOT NULL DEFAULT 1,
  usage_count         INT NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  valid_from          TIMESTAMPTZ NOT NULL,
  valid_until         TIMESTAMPTZ NOT NULL CHECK(valid_until > valid_from),
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_coupons_code   ON coupons(code) WHERE deleted_at IS NULL;
CREATE INDEX idx_coupons_type   ON coupons(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_coupons_active ON coupons(is_active, valid_from, valid_until) WHERE deleted_at IS NULL;

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자라면 유효 쿠폰 조회 가능
CREATE POLICY "coupons: 유효 쿠폰 조회" ON coupons
  FOR SELECT USING (
    is_active = true
    AND deleted_at IS NULL
    AND valid_from <= NOW()
    AND valid_until >= NOW()
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "coupons: 관리자 전체" ON coupons
  FOR ALL USING (is_admin());

CREATE TRIGGER set_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
