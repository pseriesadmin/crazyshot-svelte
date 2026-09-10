-- Migration #481: 관리자 푸시 "긴급상담" 이벤트 추가 (Stephen 승인 2026-09-10)
-- 배경: CS_ESCALATE 의도분류된 고객 채팅 메시지가 도착하면 관리자에게 즉시 브라우저 푸시
--       알림이 가야 하지만, 기존 이벤트 목록(new_reservation/contract_signed/
--       payment_completed/new_session)에 긴급상담 이벤트가 없어 미구현 상태였음.
--       기존 인프라(get_admin_push_recipients/update_admin_notify_setting)를 그대로 확장.
-- 중복방지: chat_sessions.admin_id IS NULL인 세션(실제 관리자가 한 번도 응답하지 않은 세션)
--           에서만 발송 — 앱코드(push.ts sendUrgentChatAdminPush)에서 게이팅.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_urgent_chat_message BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.admin_notify_urgent_chat_message IS '관리자 푸시: 긴급상담(CS_ESCALATE) 메시지 도착 시 수신 여부 (기본: 수신)';

-- get_admin_push_recipients — 'urgent_chat_message' 분기 추가
CREATE OR REPLACE FUNCTION public.get_admin_push_recipients(
  p_event_key TEXT
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM user_profiles
  WHERE cms_role IS NOT NULL
    AND CASE p_event_key
      WHEN 'new_reservation'        THEN admin_notify_new_reservation
      WHEN 'contract_signed'        THEN admin_notify_contract_signed
      WHEN 'payment_completed'      THEN admin_notify_payment_completed
      WHEN 'new_session'            THEN admin_notify_new_session
      WHEN 'urgent_chat_message'    THEN admin_notify_urgent_chat_message
      ELSE false
    END;
END;
$$;

-- update_admin_notify_setting — 'urgent_chat_message' 분기 추가
CREATE OR REPLACE FUNCTION public.update_admin_notify_setting(
  p_target_user_id UUID,
  p_event_key      TEXT,
  p_enabled        BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed', 'new_session', 'urgent_chat_message') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_event_key');
  END IF;

  IF p_event_key = 'new_reservation' THEN
    UPDATE user_profiles SET admin_notify_new_reservation = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSIF p_event_key = 'contract_signed' THEN
    UPDATE user_profiles SET admin_notify_contract_signed = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSIF p_event_key = 'payment_completed' THEN
    UPDATE user_profiles SET admin_notify_payment_completed = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSIF p_event_key = 'new_session' THEN
    UPDATE user_profiles SET admin_notify_new_session = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSE
    UPDATE user_profiles SET admin_notify_urgent_chat_message = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rollback:
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS admin_notify_urgent_chat_message;
-- (get_admin_push_recipients / update_admin_notify_setting는 #305 정의로 CREATE OR REPLACE 필요)
