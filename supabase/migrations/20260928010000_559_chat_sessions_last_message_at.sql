-- Migration #559: chat_sessions.last_message_at — 진짜 "마지막 대화 시각" 분리
--
-- 배경: /cms/chat 세션 목록의 시간 표시가 그동안 chat_sessions.updated_at을 그대로 썼는데,
-- 이 컬럼은 새 메시지 도착뿐 아니라 답변모드 전환(set_chat_session_manual_mode)·상태전환
-- (set_chat_session_status)·자동종료(auto_close_stale_pending_sessions 등) 같은 대화와
-- 무관한 관리성 RPC에서도 함께 갱신된다 — "마지막 대화 시각"이라는 화면 문구와 실제 값이
-- 어긋날 수 있었다(Stephen 실사용 재보고). 신규 컬럼을 추가해 chat_messages INSERT 트리거만
-- 이 컬럼을 갱신하도록 분리한다 — 다른 관리성 RPC는 이번 마이그레이션에서 전혀 손대지 않는다.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

-- 백필: 기존 값은 updated_at을 그대로 승계(이후부터 정확해짐)
UPDATE chat_sessions SET last_message_at = updated_at WHERE last_message_at IS NULL;

-- 메시지 INSERT 트리거 함수 — updated_at과 함께 last_message_at도 갱신
CREATE OR REPLACE FUNCTION update_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions
  SET updated_at = now(), last_message_at = NEW.created_at
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN chat_sessions.last_message_at IS
  'Migration #559 — chat_messages INSERT 트리거(update_chat_session_timestamp)만 갱신하는 진짜 마지막 대화 시각. updated_at은 답변모드·상태전환 등 관리성 RPC에서도 갱신되므로 화면 표시에는 이 컬럼을 우선 사용할 것.';
