-- Migration 226: 채팅 세션 자동 대기 전환 임계값 1시간 → 3시간 변경
-- 기존 Migration 38(auto_pending_inactive_sessions, 1시간)을 CREATE OR REPLACE로 재정의
-- 기존 마이그레이션 파일 직접 수정 금지(GP-10 준수) — 신규 파일로만 변경
-- pg_cron 스케줄은 이미 등록돼 있으므로 재등록 불필요 (RPC 이름 동일)

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
    AND updated_at < now() - interval '3 hours';
END;
$$;
