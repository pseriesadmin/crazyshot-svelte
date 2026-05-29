-- ★ MIGRATION: 22_notification_tokens.sql
-- Schema version: v5.46
-- Description: Support — Firebase FCM push notification device tokens
-- Dependencies: (none beyond auth.users)
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS notification_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   VARCHAR(10) NOT NULL CHECK(platform IN ('ios', 'android', 'web')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, token)
);

CREATE INDEX idx_notification_tokens_user_id ON notification_tokens(user_id) WHERE is_active = true;

ALTER TABLE notification_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_tokens: 본인 전체" ON notification_tokens
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "notification_tokens: 관리자 전체" ON notification_tokens
  FOR ALL USING (is_admin());

CREATE TRIGGER set_notification_tokens_updated_at
  BEFORE UPDATE ON notification_tokens
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
