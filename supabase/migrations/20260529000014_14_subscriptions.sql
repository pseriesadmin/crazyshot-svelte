-- ★ MIGRATION: 14_subscriptions.sql
-- Schema version: v5.46
-- Description: M4 Membership — subscription tier management
-- Dependencies: 03_user_profiles.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- Subscription tiers:
--   easy  — 9,900 KRW/month  (기본 할인)
--   pop   — 19,900 KRW/month (중간 할인 + 배달비 혜택)
--   crazy — 29,900 KRW/month (최고 할인 + 무제한 교환 + 우선 예약)

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tier                  VARCHAR(10) NOT NULL CHECK(tier IN ('easy', 'pop', 'crazy')),
  status                subscription_status_enum NOT NULL DEFAULT 'active',
  price_per_month       NUMERIC(10,2) NOT NULL CHECK(price_per_month > 0),
  billing_cycle_start   DATE NOT NULL,
  billing_cycle_end     DATE NOT NULL CHECK(billing_cycle_end > billing_cycle_start),
  auto_renew            BOOLEAN NOT NULL DEFAULT true,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  -- 유저당 하나의 활성 구독만 허용
  CONSTRAINT subscriptions_one_active_per_user
    EXCLUDE USING gist (
      user_id WITH =,
      tstzrange(billing_cycle_start::TIMESTAMPTZ, billing_cycle_end::TIMESTAMPTZ) WITH &&
    ) WHERE (status = 'active' AND deleted_at IS NULL)
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_status  ON subscriptions(status)  WHERE deleted_at IS NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions: 본인 조회" ON subscriptions
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "subscriptions: 본인 생성" ON subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "subscriptions: 관리자 전체" ON subscriptions
  FOR ALL USING (is_admin());

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
