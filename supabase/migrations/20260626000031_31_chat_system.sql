-- ★ MIGRATION: 31_chat_system.sql
-- Schema version: v5.55
-- Description: 대화형 렌탈예약 어시스턴트 시스템 V1.0 (PRD.1.7)
-- Dependencies: 03_user_profiles.sql
-- Author: Stephen Cconzy
-- Date: 2026-06-26

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────

CREATE TYPE chat_session_status_enum AS ENUM ('open', 'pending', 'closed');

CREATE TYPE chat_context_type_enum AS ENUM (
  'general', 'product_inquiry', 'reservation', 'payment', 'return'
);

CREATE TYPE chat_sender_type_enum AS ENUM ('user', 'admin', 'ai');

CREATE TYPE chat_message_type_enum AS ENUM ('text', 'action_card', 'image', 'system');

CREATE TYPE cs_record_status_enum AS ENUM ('new', 'in_progress', 'resolved');

-- ──────────────────────────────────────────────
-- TABLE: chat_sessions
-- 고객 1명 = 세션 N개 (context_type별 분리 가능)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          chat_session_status_enum NOT NULL DEFAULT 'open',
  context_type    chat_context_type_enum NOT NULL DEFAULT 'general',
  context_id      uuid,           -- product_id or reservation_id
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);

CREATE INDEX idx_chat_sessions_user_id    ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_status     ON chat_sessions(status);
CREATE INDEX idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);

-- ──────────────────────────────────────────────
-- TABLE: chat_messages
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_type     chat_sender_type_enum NOT NULL,
  content         text CHECK(length(content) <= 1000),
  message_type    chat_message_type_enum NOT NULL DEFAULT 'text',
  action_payload  jsonb,          -- 액션 카드 데이터 (6종)
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id  ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at  ON chat_messages(created_at);
CREATE INDEX idx_chat_messages_is_read     ON chat_messages(is_read) WHERE is_read = false;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_chat_message_update_session
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION update_chat_session_timestamp();

-- ──────────────────────────────────────────────
-- TABLE: chat_intent_logs
-- Claude AI 의도 분류 이력 (PRD.1.7.4)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_intent_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  intent          text NOT NULL,  -- RESERVATION_INQUIRY | PAYMENT_REQUEST | RETURN_GUIDE | PRODUCT_RECOMMEND | CS_ESCALATE | GENERAL
  confidence      float NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  raw_response    jsonb,
  processed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_intent_logs_message_id ON chat_intent_logs(message_id);
CREATE INDEX idx_chat_intent_logs_intent      ON chat_intent_logs(intent);

-- ──────────────────────────────────────────────
-- TABLE: cs_records
-- CS 접수 기록 (PRD.1.7.2.2.1)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cs_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category        text,
  status          cs_record_status_enum NOT NULL DEFAULT 'new',
  summary         text,
  admin_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cs_records_user_id   ON cs_records(user_id);
CREATE INDEX idx_cs_records_status    ON cs_records(status);

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────

ALTER TABLE chat_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_intent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cs_records      ENABLE ROW LEVEL SECURITY;

-- chat_sessions: 본인 세션만 SELECT; authenticated INSERT
CREATE POLICY "user_select_own_sessions" ON chat_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_session" ON chat_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- chat_messages: 해당 세션 참여자만 SELECT/INSERT
CREATE POLICY "user_select_session_messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_sessions
      WHERE id = chat_messages.session_id
        AND (user_id = auth.uid() OR admin_id = auth.uid())
    )
  );

CREATE POLICY "user_insert_message" ON chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions
      WHERE id = chat_messages.session_id
        AND (user_id = auth.uid() OR admin_id = auth.uid())
    )
  );

-- chat_intent_logs: 관리자 전용 (service_role RPC 처리)
CREATE POLICY "service_role_only_intent_logs" ON chat_intent_logs
  FOR ALL USING (false);  -- service_role bypasses RLS

-- cs_records: 본인 레코드 SELECT; service_role INSERT/UPDATE
CREATE POLICY "user_select_own_cs_records" ON cs_records
  FOR SELECT USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- REALTIME 활성화
-- ──────────────────────────────────────────────

-- supabase dashboard에서 chat_messages, chat_sessions 테이블 Realtime 활성화 필요
-- (CLI: supabase db diff 후 replication 설정)

COMMENT ON TABLE chat_sessions    IS 'PRD.1.7.3 — 고객-관리자 채팅 세션';
COMMENT ON TABLE chat_messages    IS 'PRD.1.7.3 — 채팅 메시지 (user/admin/ai)';
COMMENT ON TABLE chat_intent_logs IS 'PRD.1.7.4 — Claude AI 의도 분류 이력';
COMMENT ON TABLE cs_records       IS 'PRD.1.7.2.2.1 — CS 접수 기록';
