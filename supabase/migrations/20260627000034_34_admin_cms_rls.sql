-- 34_admin_cms_rls.sql
-- CMS 관리자 시스템: admin_invite_tokens, cms_login_otps, cms 컬럼, RLS 정책
-- stage DB: user_profiles.id (user_id 아님)

-- ──────────────────────────────────────────────
-- 1. user_profiles CMS 컬럼 추가 (이미 있으면 skip)
-- ──────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS cms_role text CHECK (cms_role IN ('superadmin','manager','partner')),
  ADD COLUMN IF NOT EXISTS cms_allow_concurrent_login boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cms_session_timeout_hours int;

-- ──────────────────────────────────────────────
-- 2. admin_invite_tokens 테이블
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_invite_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_by  uuid REFERENCES auth.users(id),
  used_by     uuid REFERENCES auth.users(id),
  used_at     timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_invite_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_tokens" ON admin_invite_tokens;
CREATE POLICY "admin_manage_tokens" ON admin_invite_tokens
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
    )
  );

-- ──────────────────────────────────────────────
-- 3. cms_login_otps 테이블
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_login_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  phone       text NOT NULL,
  otp_code    text NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cms_login_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_otps" ON cms_login_otps;
CREATE POLICY "service_role_only_otps" ON cms_login_otps FOR ALL USING (false);

-- ──────────────────────────────────────────────
-- 4. chat_sessions 관리자 정책
-- ──────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_sessions" ON chat_sessions;
CREATE POLICY "admin_select_all_sessions" ON chat_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "admin_update_session" ON chat_sessions;
CREATE POLICY "admin_update_session" ON chat_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
    )
  );

-- ──────────────────────────────────────────────
-- 5. chat_messages 정책 교체 (admin 포함)
-- ──────────────────────────────────────────────
DROP POLICY IF EXISTS "user_select_session_messages" ON chat_messages;
DROP POLICY IF EXISTS "participant_select_messages" ON chat_messages;
CREATE POLICY "participant_select_messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM chat_sessions cs
      WHERE cs.id = session_id
        AND (cs.user_id = auth.uid() OR cs.admin_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "user_insert_message" ON chat_messages;
DROP POLICY IF EXISTS "participant_insert_message" ON chat_messages;
CREATE POLICY "participant_insert_message" ON chat_messages
  FOR INSERT WITH CHECK (
    CASE
      WHEN EXISTS (
        SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
      ) THEN sender_type = 'admin'
      ELSE sender_type IN ('user', 'ai') AND EXISTS (
        SELECT 1 FROM chat_sessions cs
        WHERE cs.id = session_id AND cs.user_id = auth.uid()
      )
    END
  );

-- ──────────────────────────────────────────────
-- 6. cs_records 관리자 정책
-- ──────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_cs_records" ON cs_records;
CREATE POLICY "admin_select_all_cs_records" ON cs_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
    )
  );
