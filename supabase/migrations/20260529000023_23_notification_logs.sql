-- ★ MIGRATION: 23_notification_logs.sql
-- Schema version: v5.46
-- Description: Support — push/in-app notification delivery log (불변 로그)
-- Dependencies: (none beyond auth.users)
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS notification_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,   -- 'order_confirmed' | 'shipment_update' | 'damage_report' | ...
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  metadata   JSONB,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- ★ UPDATE/DELETE 없음 — 불변 발송 기록
);

CREATE INDEX idx_notification_logs_user_id ON notification_logs(user_id);
CREATE INDEX idx_notification_logs_sent_at ON notification_logs(sent_at DESC);
CREATE INDEX idx_notification_logs_type    ON notification_logs(type);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_logs: 본인 조회" ON notification_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notification_logs: 관리자 전체" ON notification_logs
  FOR ALL USING (is_admin());
