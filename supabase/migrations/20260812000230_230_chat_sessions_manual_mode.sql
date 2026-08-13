-- Migration 230: chat_sessions.manual_mode 컬럼 추가
-- GSD-7: P3-1 담당자 자동응답 → 직접답변 수동전환 버튼
-- ADD-only: 기존 세션 전부 false(자동응답 유지)로 백필

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS manual_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chat_sessions.manual_mode IS
  'true: 이 세션에서 자동응답(캔드매칭+AI폴백) 완전 비활성화, 관리자 직접 답변 전용';

-- RPC: set_chat_session_manual_mode — GSD-8이 이 RPC를 호출
CREATE OR REPLACE FUNCTION public.set_chat_session_manual_mode(
  p_session_id uuid,
  p_manual_mode boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE chat_sessions
  SET manual_mode = p_manual_mode,
      updated_at  = now()
  WHERE id = p_session_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) FROM anon, authenticated;
