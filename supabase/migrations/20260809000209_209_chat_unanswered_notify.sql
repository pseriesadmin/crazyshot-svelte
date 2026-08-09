-- Migration 209: 관리자 미응답 채팅 세션 FCM 알림 인프라 (CS-A3)
-- ① chat_sessions에 unanswered_notified_at 컬럼 추가 — 중복 발송 방지용
-- ② get_and_mark_unanswered_sessions() RPC — 미응답 세션 user_id 조회 + 동시에 notified_at 갱신
-- ③ push_notification_config에 chat_unanswered 등록

-- ──────────────────────────────────────────────────────────────
-- 1. unanswered_notified_at 컬럼 추가
-- ──────────────────────────────────────────────────────────────
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS unanswered_notified_at timestamptz;

-- ──────────────────────────────────────────────────────────────
-- 2. get_and_mark_unanswered_sessions()
--    조건: status='open', unanswered_notified_at IS NULL,
--         마지막 메시지 발신자가 user 또는 ai,
--         그 메시지가 30분 이상 경과
--    동작: 해당 세션들의 unanswered_notified_at = NOW() 갱신 (중복 방지)
--         + 대상 user_id 반환 (push.ts가 각 user_id에 FCM 발송)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_and_mark_unanswered_sessions()
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE chat_sessions s
  SET unanswered_notified_at = now()
  FROM (
    SELECT DISTINCT ON (cm.session_id)
      cm.session_id,
      cm.sender_type,
      cm.created_at
    FROM chat_messages cm
    ORDER BY cm.session_id, cm.created_at DESC
  ) last_msg
  WHERE s.id = last_msg.session_id
    AND s.status = 'open'
    AND s.unanswered_notified_at IS NULL
    AND last_msg.sender_type IN ('user', 'ai')
    AND last_msg.created_at <= now() - interval '30 minutes'
  RETURNING s.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_and_mark_unanswered_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_and_mark_unanswered_sessions() TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 3. push_notification_config 등록
-- ──────────────────────────────────────────────────────────────
INSERT INTO push_notification_config (category, notify_type, label, push_enabled)
VALUES ('customer_lifecycle', 'chat_unanswered', '미답변 상담 알림', true)
ON CONFLICT (notify_type) DO NOTHING;

-- rollback:
-- ALTER TABLE chat_sessions DROP COLUMN IF EXISTS unanswered_notified_at;
-- DROP FUNCTION IF EXISTS public.get_and_mark_unanswered_sessions();
-- DELETE FROM push_notification_config WHERE notify_type = 'chat_unanswered';
