-- 688: 고객 채팅 대화목록 "삭제" = 고객 화면에서만 숨김 (관리자 상담 히스토리는 보존)
-- 세션/메시지는 지우지 않고 chat_sessions.customer_cleared_at 이후 메시지만 고객에게 보인다.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS customer_cleared_at timestamptz;

COMMENT ON COLUMN public.chat_sessions.customer_cleared_at IS
  '고객이 대화목록을 삭제한 시각 — 고객 화면은 이 시각 이후 메시지만 표시. 관리자 화면은 영향 없음.';

CREATE OR REPLACE FUNCTION public.clear_my_chat_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.chat_sessions
     SET customer_cleared_at = now()
   WHERE user_id = v_uid;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_my_chat_history() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_my_chat_history() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_my_chat_history() TO authenticated, service_role;
