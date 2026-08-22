-- Migration #328: "빠른 문의" 신규 등록 시 상담채팅으로 관리자 알림 신설
--
-- 배경 (2026-08-21, Stephen 요청): 고객이 빠른문의(cs_posts)를 새로 남기면 관리자가 CMS
-- 채팅(/cms/chat)에서 바로 알림 카드를 받아 답변 등록 화면으로 진입할 수 있어야 하는데,
-- 지금까지 이 방향(고객→관리자) 알림이 아예 없었다(Migration 302는 반대 방향 — 관리자
-- 답변 등록 시 고객에게 알림). 세션 조사로 관련 트리거/RPC가 전혀 없음을 확인 후 신설.
--
-- submit_cs_post는 파라미터 시그니처 변경 없이(CREATE OR REPLACE로 충분) INSERT 직후
-- 관리자용 chat_messages action_card를 추가한다 — add_cs_reply(migration 302)와 동일하게
-- find_or_create_general_chat_session 공용 헬퍼를 재사용(service-operations.md §11 원칙).
-- sender_type은 'user'로 설정한다 — 이 알림은 실제로 고객이 남긴 문의 자체를 관리자에게
-- 전달하는 것이라, 관리자 발신 알림들(sender_type='admin')과 의미상 반대 방향이기 때문.

CREATE OR REPLACE FUNCTION public.submit_cs_post(
  p_title    TEXT,
  p_content  TEXT,
  p_category TEXT DEFAULT 'general'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         UUID;
  v_session_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO cs_posts (user_id, title, content, category)
  VALUES (auth.uid(), p_title, p_content, p_category)
  RETURNING id INTO v_id;

  -- [신규] 신규 문의 등록 → 상담채팅 대화카드 알림(관리자 수신). 빠른 문의는 예약과
  -- 무관하므로 p_reservation_id는 항상 NULL — general 세션 탐색/생성만 수행.
  v_session_id := public.find_or_create_general_chat_session(auth.uid(), NULL);

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'user', 'action_card',
    COALESCE(p_title, '문의') || ' — 새 빠른문의가 접수되었습니다',
    jsonb_build_object(
      'type',         'INQUIRY_NEW_CARD',
      'post_id',       v_id::TEXT,
      'title',         p_title,
      'button_label',  '빠른문의 답변등록',
      'action_url',    '/cms/customers/inquiry'
    ),
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cs_post TO authenticated;

-- ============================================================
-- ROLLBACK: 위 함수를 migration 157(20260724000157_157_cs_inquiry_rpcs.sql)의
-- 원본 정의(CREATE OR REPLACE public.submit_cs_post, 83-104행)로 재적용하면 됨.
-- ============================================================
