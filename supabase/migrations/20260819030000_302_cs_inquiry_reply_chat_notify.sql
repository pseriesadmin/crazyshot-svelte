-- Migration #302: "빠른 문의" 답변 등록 시 상담채팅 대화카드 알림 신설 (Stephen 승인 2026-08-19)
-- 배경: 조사 결과 add_cs_reply(빠른 문의 답변 등록)는 cs_inquiries INSERT + cs_posts.status
--       갱신만 하고, 예약/결제/계약 알림과 달리 상담채팅으로는 아무 알림도 보내지 않았다
--       (애초에 구현된 적 없는 기능 — "끊김"이 아님). 기존 예약 알림 함수들(migration 282)과
--       동일하게 공용 헬퍼 find_or_create_general_chat_session을 그대로 재사용한다
--       (service-operations.md §11 원칙 — 관리자 발신 알림은 반드시 이 RPC 경유).

CREATE OR REPLACE FUNCTION public.add_cs_reply(
  p_post_id       UUID,
  p_responder_id  UUID,
  p_response      TEXT,
  p_is_resolution BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id         UUID;
  v_user_id    UUID;
  v_title      TEXT;
  v_session_id UUID;
BEGIN
  INSERT INTO cs_inquiries (cs_post_id, responder_id, response, is_resolution)
  VALUES (p_post_id, p_responder_id, p_response, p_is_resolution)
  RETURNING id INTO v_id;

  -- 상태 자동 갱신
  IF p_is_resolution THEN
    UPDATE cs_posts SET status = 'resolved' WHERE id = p_post_id AND deleted_at IS NULL;
  ELSE
    UPDATE cs_posts SET status = 'in_progress'
    WHERE id = p_post_id AND status = 'open' AND deleted_at IS NULL;
  END IF;

  -- [신규] 답변 등록 → 상담채팅 대화카드 알림 (빠른 문의는 예약과 무관하므로
  -- p_reservation_id는 항상 NULL — general 세션 탐색/생성만 수행)
  SELECT user_id, title INTO v_user_id, v_title
  FROM cs_posts
  WHERE id = p_post_id AND deleted_at IS NULL;

  IF v_user_id IS NOT NULL THEN
    v_session_id := public.find_or_create_general_chat_session(v_user_id, NULL);

    INSERT INTO chat_messages (
      session_id, sender_type, message_type, content, action_payload, is_read
    ) VALUES (
      v_session_id, 'admin', 'action_card',
      COALESCE(v_title, '문의') || '에 대한 답변이 등록되었습니다',
      jsonb_build_object(
        'type',       'INQUIRY_REPLY_CARD',
        'post_id',    p_post_id::TEXT,
        'title',      v_title,
        'action_url', '/account/inquiry'
      ),
      false
    );

    UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;
  END IF;

  RETURN v_id;
END;
$$;

-- rollback:
-- 위 함수를 migration 157(20260724000157_157_cs_inquiry_rpcs.sql)의 원본 정의로 재적용
