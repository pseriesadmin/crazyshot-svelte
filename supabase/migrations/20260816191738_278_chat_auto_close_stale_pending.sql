-- Migration 278: '대기'(pending) 상담이 3일 이상 방치되면 자동 '종료'(closed) 전환
-- Stephen 확정(2026-08-17): 대기 한도 3일. auto_pending_inactive_sessions(3시간, migration 226)와
-- 동일 패턴 — pg_cron으로 독립 실행, 관리자가 화면을 보고 있지 않아도 자동 동작.

CREATE OR REPLACE FUNCTION public.auto_close_stale_pending_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_sessions
  SET
    status     = 'closed',
    updated_at = now()
  WHERE
    status     = 'pending'
    AND updated_at < now() - interval '3 days';
END;
$$;

-- authenticated_rpc_lockdown(migration 263)과 동일 원칙 — service_role 전용
REVOKE EXECUTE ON FUNCTION public.auto_close_stale_pending_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_stale_pending_sessions() TO service_role;

-- 기존 동일 이름 job 제거 후 재등록 (idempotent) — 1시간마다 실행(3일 단위 임계값이라 10분 주기 불필요)
SELECT cron.unschedule('auto-close-stale-pending-chat-sessions')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-close-stale-pending-chat-sessions'
);

SELECT cron.schedule(
  'auto-close-stale-pending-chat-sessions',
  '0 * * * *',
  $$SELECT auto_close_stale_pending_sessions();$$
);

-- rollback:
-- SELECT cron.unschedule('auto-close-stale-pending-chat-sessions');
-- DROP FUNCTION IF EXISTS public.auto_close_stale_pending_sessions();
