-- ★ MIGRATION: 16_user_coupons.sql
-- Schema version: v5.46
-- Description: M4 Membership — user-coupon assignment and usage tracking
-- Dependencies: 15_coupons.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS user_coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coupon_id   UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  used_at     TIMESTAMPTZ,
  used_count  INT NOT NULL DEFAULT 0 CHECK(used_count >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, coupon_id)
);

CREATE INDEX idx_user_coupons_user_id   ON user_coupons(user_id);
CREATE INDEX idx_user_coupons_coupon_id ON user_coupons(coupon_id);

ALTER TABLE user_coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_coupons: 본인 조회" ON user_coupons
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_coupons: 관리자 전체" ON user_coupons
  FOR ALL USING (is_admin());

-- ★ 쿠폰 사용 시 coupons.usage_count 자동 증가 트리거
CREATE OR REPLACE FUNCTION trigger_increment_coupon_usage_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
    UPDATE coupons
    SET usage_count = usage_count + 1
    WHERE id = NEW.coupon_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER increment_coupon_usage_count
  AFTER UPDATE ON user_coupons
  FOR EACH ROW EXECUTE FUNCTION trigger_increment_coupon_usage_count();
