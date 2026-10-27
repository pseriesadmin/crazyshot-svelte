-- 776: 비회원(익명 계정) 채팅을 회원 계정 채팅으로 통합 (2026-10-27, Stephen 지시 — 로그인할 때마다 자동 통합 + 이미 쌓인 건 일회성 통합)
-- 배경: 가입을 비회원 채팅 세션에서 시작하면 익명→회원 전환(updateUser)으로 계정 ID가 유지돼 채팅이 따라가지만,
--       "이미 있는 회원 계정으로 로그인"하면 비회원 계정이 버려져 그 채팅이 고아로 남았다.
-- 정책: ① 서버 전용(service_role) — 호출 API가 "비회원 토큰 + 회원 세션"을 둘 다 확인한 뒤에만 부른다
--       ② 같은 종류(context_type·context_id·context_reservation_id)의 회원 세션이 있으면 메시지·메모·북마크 등을 그 세션으로 옮기고 비회원 세션은 삭제,
--          없으면 비회원 세션을 통째로 회원 소유로 바꾼다
--       ③ 옮긴 항목의 id를 모두 chat_guest_merge_log에 남겨 되돌릴 수 있게 한다(관리자 전용, 정책 0건)
--       ④ 같은 호출을 다시 해도 안전(옮길 세션이 없으면 아무것도 하지 않음)

CREATE TABLE IF NOT EXISTS public.chat_guest_merge_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_user_id       uuid NOT NULL,
  member_user_id      uuid NOT NULL,
  guest_session_id    uuid NOT NULL,
  member_session_id   uuid,            -- NULL이면 세션을 통째로 옮김(회원에게 같은 종류 세션이 없었음)
  guest_session_row   jsonb NOT NULL,  -- 삭제 전 비회원 세션 행 전체(되돌리기용)
  moved_message_ids   uuid[] NOT NULL DEFAULT '{}',
  moved_bookmark_ids  uuid[] NOT NULL DEFAULT '{}',
  moved_cs_record_ids uuid[] NOT NULL DEFAULT '{}',
  moved_agent_request_ids uuid[] NOT NULL DEFAULT '{}',
  moved_candidate_ids uuid[] NOT NULL DEFAULT '{}',
  moved_observation_ids uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_guest_merge_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_guest_merge_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_guest_merge_log TO service_role;
CREATE INDEX IF NOT EXISTS idx_chat_guest_merge_log_member ON public.chat_guest_merge_log (member_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.merge_guest_chat_into_member(p_guest_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_anon   boolean;
  v_gs        public.chat_sessions%ROWTYPE;
  v_ms        public.chat_sessions%ROWTYPE;
  v_msgs      uuid[];
  v_marks     uuid[];
  v_recs      uuid[];
  v_reqs      uuid[];
  v_cands     uuid[];
  v_obs       uuid[];
  v_sessions  int := 0;
  v_messages  int := 0;
BEGIN
  IF p_guest_id IS NULL OR p_member_id IS NULL THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
  IF p_guest_id = p_member_id THEN RAISE EXCEPTION 'SAME_USER'; END IF;

  SELECT is_anonymous INTO v_is_anon FROM auth.users WHERE id = p_guest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND'; END IF;
  IF NOT COALESCE(v_is_anon, false) THEN RAISE EXCEPTION 'GUEST_NOT_ANONYMOUS'; END IF;

  SELECT is_anonymous INTO v_is_anon FROM auth.users WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF COALESCE(v_is_anon, false) THEN RAISE EXCEPTION 'MEMBER_IS_ANONYMOUS'; END IF;

  FOR v_gs IN
    SELECT * FROM public.chat_sessions WHERE user_id = p_guest_id ORDER BY created_at FOR UPDATE
  LOOP
    SELECT * INTO v_ms FROM public.chat_sessions
     WHERE user_id = p_member_id
       AND context_type = v_gs.context_type
       AND context_id IS NOT DISTINCT FROM v_gs.context_id
       AND context_reservation_id IS NOT DISTINCT FROM v_gs.context_reservation_id
     ORDER BY created_at LIMIT 1 FOR UPDATE;

    IF NOT FOUND THEN
      -- 회원에게 같은 종류 세션이 없다 → 세션을 통째로 회원 소유로
      UPDATE public.chat_sessions SET user_id = p_member_id WHERE id = v_gs.id;
      UPDATE public.cs_records SET user_id = p_member_id WHERE session_id = v_gs.id;
      UPDATE public.chat_agent_requests SET user_id = p_member_id WHERE session_id = v_gs.id;
      INSERT INTO public.chat_guest_merge_log (guest_user_id, member_user_id, guest_session_id, member_session_id, guest_session_row)
      VALUES (p_guest_id, p_member_id, v_gs.id, NULL, to_jsonb(v_gs));
      v_sessions := v_sessions + 1;
      CONTINUE;
    END IF;

    -- 같은 종류 세션이 있다 → 항목을 회원 세션으로 옮기고(created_at 그대로라 시간순으로 섞임) 비회원 세션 삭제
    WITH m AS (UPDATE public.chat_messages SET session_id = v_ms.id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_msgs FROM m;
    WITH m AS (UPDATE public.chat_message_bookmarks SET session_id = v_ms.id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_marks FROM m;
    WITH m AS (UPDATE public.cs_records SET session_id = v_ms.id, user_id = p_member_id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_recs FROM m;
    WITH m AS (UPDATE public.chat_agent_requests SET session_id = v_ms.id, user_id = p_member_id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_reqs FROM m;
    WITH m AS (UPDATE public.chat_reply_candidates SET session_id = v_ms.id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_cands FROM m;
    WITH m AS (UPDATE public.ai_reply_observations SET session_id = v_ms.id WHERE session_id = v_gs.id RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO v_obs FROM m;

    UPDATE public.chat_sessions
       SET admin_id        = COALESCE(v_ms.admin_id, v_gs.admin_id),
           manual_mode     = COALESCE(v_ms.manual_mode, false) OR COALESCE(v_gs.manual_mode, false),
           status          = CASE WHEN v_ms.status = 'closed' AND v_gs.status <> 'closed' THEN v_gs.status ELSE v_ms.status END,
           closed_at       = CASE WHEN v_ms.status = 'closed' AND v_gs.status <> 'closed' THEN NULL ELSE v_ms.closed_at END,
           last_message_at = GREATEST(v_ms.last_message_at, v_gs.last_message_at),
           updated_at      = now()
     WHERE id = v_ms.id;

    INSERT INTO public.chat_guest_merge_log (
      guest_user_id, member_user_id, guest_session_id, member_session_id, guest_session_row,
      moved_message_ids, moved_bookmark_ids, moved_cs_record_ids, moved_agent_request_ids, moved_candidate_ids, moved_observation_ids
    ) VALUES (
      p_guest_id, p_member_id, v_gs.id, v_ms.id, to_jsonb(v_gs), v_msgs, v_marks, v_recs, v_reqs, v_cands, v_obs
    );

    DELETE FROM public.chat_sessions WHERE id = v_gs.id; -- 자식 행은 위에서 모두 옮겨 두었다(남은 것이 없어 연쇄 삭제될 대상 없음)
    v_sessions := v_sessions + 1;
    v_messages := v_messages + COALESCE(array_length(v_msgs, 1), 0);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sessions', v_sessions, 'messages', v_messages);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) TO service_role;

-- ROLLBACK(통합 자체 되돌리기는 chat_guest_merge_log의 moved_* id로 수동 복구):
--   DROP FUNCTION IF EXISTS public.merge_guest_chat_into_member(uuid, uuid);
--   DROP TABLE IF EXISTS public.chat_guest_merge_log;
