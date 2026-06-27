-- Migration 38: 비활성 채팅 세션 자동 대기 이동
-- open 상태에서 1시간 이상 비활성 → pending 으로 자동 전환
-- pg_cron: 10분마다 실행

CREATE OR REPLACE FUNCTION auto_pending_inactive_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE chat_sessions
  SET
    status     = 'pending',
    updated_at = now()
  WHERE
    status     = 'open'
    AND updated_at < now() - interval '1 hour';
END;
$$;

-- 기존 동일 이름 job 제거 후 재등록 (idempotent)
SELECT cron.unschedule('auto-pending-inactive-chat-sessions')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-pending-inactive-chat-sessions'
);

SELECT cron.schedule(
  'auto-pending-inactive-chat-sessions',
  '*/10 * * * *',
  $$SELECT auto_pending_inactive_sessions();$$
);
