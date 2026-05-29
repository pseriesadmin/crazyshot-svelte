-- ★ MIGRATION: 28_foreign_users.sql
-- Schema version: v5.46
-- Description: Support — foreign user extended authentication info (외국인 인증)
-- Dependencies: 03_user_profiles.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- 외국인 인증 단계 (user_profiles.auth_level):
--   LV.0: 미인증 (결제 불가)
--   LV.1: 여권 번호 제출 (기본 렌탈 가능)
--   LV.2: 비자 확인 (할인 일부 적용)
--   LV.3: 완전 인증 (내국인 동등 혜택)

CREATE TABLE IF NOT EXISTS foreign_users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  country          VARCHAR(5) NOT NULL,     -- ISO 3166-1 alpha-2
  passport_number  VARCHAR(50) NOT NULL,
  visa_type        VARCHAR(50),
  auth_level       SMALLINT NOT NULL DEFAULT 0 CHECK(auth_level BETWEEN 0 AND 3),
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_foreign_users_user_id    ON foreign_users(user_id);
CREATE INDEX idx_foreign_users_auth_level ON foreign_users(auth_level);

ALTER TABLE foreign_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "foreign_users: 본인 조회" ON foreign_users
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "foreign_users: 본인 생성/수정" ON foreign_users
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "foreign_users: 관리자 전체" ON foreign_users
  FOR ALL USING (is_admin());

CREATE TRIGGER set_foreign_users_updated_at
  BEFORE UPDATE ON foreign_users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
