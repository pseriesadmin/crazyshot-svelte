-- 777: 비회원 채팅 통합(#776) 보정 — 일반 상담 세션은 예약 번호와 상관없이 같은 종류로 본다 (2026-10-27, Stephen 지시)
-- 결함(#776): 회원 세션을 "예약 번호까지 같은 세션"으로만 찾아, 회원에게 예약(332번) 연결 일반 세션이 있으면 비회원 일반 세션이 합쳐지지 않고 세션이 둘로 남았다.
-- 시스템 규칙: 회원 1명당 일반 상담 세션 1개(find_or_create_general_chat_session은 가장 최근 일반 세션을 재사용하고 예약 번호는 그 세션에 붙인다).
-- 변경: ① 세션 합치기 본체를 private.merge_chat_session_into 로 분리(이동 6종 + 로그 + 세션 삭제) ② merge_guest_chat_into_member 는 일반 세션이면
--       회원의 가장 최근 일반 세션으로 합치고(예약 번호는 비어 있으면 이어받음) 그 외 종류는 기존처럼 정확히 같은 종류끼리만 ③ 같은 회원의 일반 세션이 이미 둘 이상 갈라져 있을 때
--       합치는 서버 전용 함수 merge_member_chat_sessions(p_from, p_into) 신설 — 같은 회원·일반 세션끼리만 허용

CREATE OR REPLACE FUNCTION private.merge_chat_session_into(p_from uuid, p_into uuid, p_log_guest_id uuid, p_member_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gs    public.chat_sessions%ROWTYPE;
  v_ms    public.chat_sessions%ROWTYPE;
  v_msgs  uuid[];
  v_marks uuid[];
  v_recs  uuid[];
  v_reqs  uuid[];
  v_cands uuid[];
  v_obs   uuid[];
BEGIN
  PERFORM 1 FROM public.chat_sessions WHERE id IN (p_from, p_into) ORDER BY id FOR UPDATE; -- 항상 id 순서로 잠가 교착 방지
  SELECT * INTO v_gs FROM public.chat_sessions WHERE id = p_from;
  IF NOT FOUND THEN RAISE EXCEPTION 'FROM_SESSION_NOT_FOUND'; END IF;
  SELECT * INTO v_ms FROM public.chat_sessions WHERE id = p_into;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTO_SESSION_NOT_FOUND'; END IF;

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
  UPDATE public.chat_message_deletions SET session_id = v_ms.id WHERE session_id = v_gs.id; -- 삭제된 대화 원본 보관(FK 없음) — 함께 옮겨 세션 기준 조회에서 빠지지 않게

  UPDATE public.chat_sessions
     SET admin_id                = COALESCE(v_ms.admin_id, v_gs.admin_id),
         manual_mode             = COALESCE(v_ms.manual_mode, false) OR COALESCE(v_gs.manual_mode, false),
         status                  = CASE WHEN v_ms.status = 'closed' AND v_gs.status <> 'closed' THEN v_gs.status ELSE v_ms.status END,
         closed_at               = CASE WHEN v_ms.status = 'closed' AND v_gs.status <> 'closed' THEN NULL ELSE v_ms.closed_at END,
         context_reservation_id  = COALESCE(v_ms.context_reservation_id, v_gs.context_reservation_id),
         last_message_at         = GREATEST(v_ms.last_message_at, v_gs.last_message_at),
         updated_at              = now()
   WHERE id = v_ms.id;

  INSERT INTO public.chat_guest_merge_log (
    guest_user_id, member_user_id, guest_session_id, member_session_id, guest_session_row,
    moved_message_ids, moved_bookmark_ids, moved_cs_record_ids, moved_agent_request_ids, moved_candidate_ids, moved_observation_ids
  ) VALUES (
    p_log_guest_id, p_member_id, v_gs.id, v_ms.id, to_jsonb(v_gs), v_msgs, v_marks, v_recs, v_reqs, v_cands, v_obs
  );

  DELETE FROM public.chat_sessions WHERE id = v_gs.id; -- 자식 행은 위에서 모두 옮겨 두었다
  RETURN COALESCE(array_length(v_msgs, 1), 0);
END;
$$;
REVOKE ALL ON FUNCTION private.merge_chat_session_into(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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
    IF v_gs.context_type = 'general' THEN
      -- 일반 상담은 회원 1명당 1개 — 예약 번호와 상관없이 가장 최근 일반 세션(find_or_create_general_chat_session 과 같은 기준)으로 합친다
      SELECT * INTO v_ms FROM public.chat_sessions
       WHERE user_id = p_member_id AND context_type = 'general'
       ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
    ELSE
      SELECT * INTO v_ms FROM public.chat_sessions
       WHERE user_id = p_member_id
         AND context_type = v_gs.context_type
         AND context_id IS NOT DISTINCT FROM v_gs.context_id
         AND context_reservation_id IS NOT DISTINCT FROM v_gs.context_reservation_id
       ORDER BY created_at LIMIT 1 FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      UPDATE public.chat_sessions SET user_id = p_member_id WHERE id = v_gs.id;
      UPDATE public.cs_records SET user_id = p_member_id WHERE session_id = v_gs.id;
      UPDATE public.chat_agent_requests SET user_id = p_member_id WHERE session_id = v_gs.id;
      INSERT INTO public.chat_guest_merge_log (guest_user_id, member_user_id, guest_session_id, member_session_id, guest_session_row)
      VALUES (p_guest_id, p_member_id, v_gs.id, NULL, to_jsonb(v_gs));
      v_sessions := v_sessions + 1;
      CONTINUE;
    END IF;

    v_messages := v_messages + private.merge_chat_session_into(v_gs.id, v_ms.id, p_guest_id, p_member_id);
    v_sessions := v_sessions + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sessions', v_sessions, 'messages', v_messages);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_chat_into_member(uuid, uuid) TO service_role;

-- 같은 회원의 일반 상담 세션이 둘 이상으로 갈라져 있을 때 하나로 합친다(서버 전용, 관리자 작업용)
CREATE OR REPLACE FUNCTION public.merge_member_chat_sessions(p_from uuid, p_into uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from  public.chat_sessions%ROWTYPE;
  v_into  public.chat_sessions%ROWTYPE;
  v_anon  boolean;
  v_count int;
BEGIN
  IF p_from IS NULL OR p_into IS NULL THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
  IF p_from = p_into THEN RAISE EXCEPTION 'SAME_SESSION'; END IF;
  SELECT * INTO v_from FROM public.chat_sessions WHERE id = p_from;
  IF NOT FOUND THEN RAISE EXCEPTION 'FROM_SESSION_NOT_FOUND'; END IF;
  SELECT * INTO v_into FROM public.chat_sessions WHERE id = p_into;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTO_SESSION_NOT_FOUND'; END IF;
  IF v_from.user_id <> v_into.user_id THEN RAISE EXCEPTION 'DIFFERENT_USER'; END IF;
  IF v_from.context_type <> 'general' OR v_into.context_type <> 'general' THEN RAISE EXCEPTION 'NOT_GENERAL_SESSION'; END IF;
  SELECT is_anonymous INTO v_anon FROM auth.users WHERE id = v_from.user_id;
  IF COALESCE(v_anon, false) THEN RAISE EXCEPTION 'USER_IS_ANONYMOUS'; END IF;
  v_count := private.merge_chat_session_into(p_from, p_into, v_from.user_id, v_from.user_id);
  RETURN jsonb_build_object('ok', true, 'messages', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.merge_member_chat_sessions(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_member_chat_sessions(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_member_chat_sessions(uuid, uuid) TO service_role;

-- ROLLBACK: #776 본문의 merge_guest_chat_into_member 로 복원 + DROP FUNCTION public.merge_member_chat_sessions(uuid, uuid), private.merge_chat_session_into(uuid, uuid, uuid, uuid);
--           (이동 내역은 chat_guest_merge_log — 테이블을 지우기 전에 백업할 것)
