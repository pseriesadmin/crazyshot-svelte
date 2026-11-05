-- 793: 예약 상담 세션을 고객의 일반 상담 세션으로 합친다 — 고객당 대화 1개 원칙 (2026-11-05, Stephen 지시 "1개로 통합")
-- 배경: 마이페이지 [상담]으로 열린 예약 전용 세션(context_type='reservation')이 알림용 일반 세션과 따로 남아
--       관리자 목록에 같은 고객 카드가 두 장 보였다. 앱 코드는 이제 예약 상담을 일반 세션에 이어 붙인다(ChatWindow).
-- 이 파일은 이미 갈라진 기존 건 정리: 일반 세션이 있는 고객의 예약 세션을 그 일반 세션(가장 최근)으로 합친다.
--   - 이동·로그·삭제는 #777의 private.merge_chat_session_into 재사용(chat_guest_merge_log에 되돌릴 근거 기록)
--   - 일반 세션이 없는 고객의 예약 세션은 그대로 둔다(앱 코드가 다음 상담 때 일반 세션을 새로 만든다)
--   - 다시 실행해도 안전(합칠 예약 세션이 없으면 아무 일도 하지 않음)

DO $$
DECLARE
  r      record;
  v_into uuid;
BEGIN
  FOR r IN
    SELECT id, user_id FROM public.chat_sessions
     WHERE context_type = 'reservation'
     ORDER BY user_id, created_at
  LOOP
    SELECT id INTO v_into FROM public.chat_sessions
     WHERE user_id = r.user_id AND context_type = 'general'
     ORDER BY updated_at DESC LIMIT 1;
    CONTINUE WHEN v_into IS NULL;
    PERFORM private.merge_chat_session_into(r.id, v_into, r.user_id, r.user_id);
  END LOOP;
END;
$$;

-- ROLLBACK: chat_guest_merge_log 의 guest_session_row/moved_*_ids 로 복원(guest_user_id = member_user_id 인 행이 이 정리 건)
