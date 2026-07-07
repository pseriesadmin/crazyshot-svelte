-- migration #56: marketing_rules + marketing_rule_logs 테이블
-- Phase 3 — Rule Engine DB 기반
-- 의존성: auth.users, user_profiles

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. marketing_rules 테이블
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_rules (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  trigger_type VARCHAR(30) NOT NULL
    CHECK (trigger_type IN ('cart_abandon_24h', 'dormant_30d', 'vip_upgrade', 'birthday', 'signup')),
  trigger_meta JSONB,
  action_type  VARCHAR(20) NOT NULL
    CHECK (action_type IN ('send_coupon', 'grant_points', 'send_notification', 'send_kakao')),
  action_meta  JSONB,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. marketing_rule_logs 테이블
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_rule_logs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id      UUID REFERENCES marketing_rules(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ DEFAULT now(),
  result       JSONB
);

CREATE INDEX IF NOT EXISTS idx_mrl_rule      ON marketing_rule_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_mrl_user      ON marketing_rule_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_mrl_triggered ON marketing_rule_logs(triggered_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE marketing_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_rule_logs ENABLE ROW LEVEL SECURITY;

-- marketing_rules: CMS 관리자 전체 접근
CREATE POLICY "cms_marketing_rules_select" ON marketing_rules
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  ));

CREATE POLICY "cms_marketing_rules_write" ON marketing_rules
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  ));

-- marketing_rule_logs: CMS 관리자 전체 접근
CREATE POLICY "cms_rule_logs_select" ON marketing_rule_logs
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  ));

CREATE POLICY "cms_rule_logs_write" ON marketing_rule_logs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  ));


-- ── ROLLBACK ──
-- DROP TABLE IF EXISTS marketing_rule_logs CASCADE;
-- DROP TABLE IF EXISTS marketing_rules CASCADE;
