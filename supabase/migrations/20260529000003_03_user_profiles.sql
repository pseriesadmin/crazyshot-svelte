-- ★ MIGRATION: 03_user_profiles.sql
-- Schema version: v5.46
-- Description: User profile and membership management
-- Dependencies: 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

-- Main user profile table (SSOT for user data)
CREATE TABLE IF NOT EXISTS user_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(20),
  name                 VARCHAR(100),
  address              JSONB,
  credit_score         SMALLINT NOT NULL DEFAULT 70 CHECK(credit_score BETWEEN 0 AND 100),
  membership_grade     membership_grade_enum NOT NULL DEFAULT 'none',
  -- Duplicate for materialized view convenience (GENERATED ALWAYS AS)
  grade                membership_grade_enum GENERATED ALWAYS AS (membership_grade) STORED,
  is_student           BOOLEAN NOT NULL DEFAULT false,
  student_verified_at  TIMESTAMPTZ,
  student_doc_url      VARCHAR(500),
  is_foreign           BOOLEAN NOT NULL DEFAULT false,
  auth_level           SMALLINT DEFAULT 0 CHECK(auth_level BETWEEN 0 AND 3),  -- Foreign auth level (LV.0~3)
  rental_count         INT NOT NULL DEFAULT 0,
  late_return_count    INT NOT NULL DEFAULT 0,
  damage_count         INT NOT NULL DEFAULT 0,
  points               INT NOT NULL DEFAULT 0 CHECK(points >= 0),
  blacklisted          BOOLEAN NOT NULL DEFAULT false,
  blacklist_reason     TEXT,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_grade ON user_profiles(membership_grade) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_profiles_active ON user_profiles(user_id) WHERE deleted_at IS NULL;

-- Row-level security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles: 본인 조회" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_profiles: 본인 수정" ON user_profiles
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_profiles: 관리자 전체" ON user_profiles
  FOR ALL USING (is_admin());

-- Auto-update timestamp trigger
CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
