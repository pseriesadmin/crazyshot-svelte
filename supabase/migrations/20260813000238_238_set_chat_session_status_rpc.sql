-- Migration 238: set_chat_session_status RPC
-- M2 QA Fix: reopen/pending API가 직접 UPDATE(H-01 위반) 대신 RPC를 경유하도록
-- 기존 마이그레이션 파일 직접 수정 금지(GP-10) — 신규 파일로만 추가

CREATE OR REPLACE FUNCTION public.set_chat_session_status(
  p_session_id uuid,
  p_status     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid_statuses text[] := ARRAY['open', 'pending', 'closed'];
  v_old_status     text;
  v_result         jsonb;
BEGIN
  -- 유효한 상태 값 검증
  IF NOT (p_status = ANY(v_valid_statuses)) THEN
    RAISE EXCEPTION 'set_chat_session_status: 유효하지 않은 상태입니다 — %. 허용값: open, pending, closed', p_status;
  END IF;

  -- 현재 상태 조회
  SELECT status::text INTO v_old_status
  FROM chat_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_chat_session_status: 세션을 찾을 수 없습니다 — %', p_session_id;
  END IF;

  -- 동일 상태면 no-op (idempotent)
  IF v_old_status = p_status THEN
    RETURN jsonb_build_object(
      'session_id', p_session_id,
      'old_status', v_old_status,
      'new_status', p_status,
      'changed',    false
    );
  END IF;

  -- 상태 업데이트
  UPDATE chat_sessions
  SET
    status     = p_status::chat_session_status_enum,
    updated_at = now()
  WHERE id = p_session_id;

  v_result := jsonb_build_object(
    'session_id', p_session_id,
    'old_status', v_old_status,
    'new_status', p_status,
    'changed',    true
  );

  RETURN v_result;
END;
$$;

-- 권한 설정: anon·authenticated 제외, service_role만 EXECUTE
REVOKE EXECUTE ON FUNCTION public.set_chat_session_status(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_chat_session_status(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_chat_session_status(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.set_chat_session_status(uuid, text) TO service_role;
