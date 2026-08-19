-- Migration #305: 관리자 푸시 "신규 상담" 이벤트 추가 (Stephen 승인 2026-08-19)
-- (원래 #299로 생성됐으나 동시 진행 중이던 다른 세션의 coupon_redemptions_include_manual
--  마이그레이션과 번호 충돌 확인되어 #305로 재번호 — 내용 변경 없음, Migration #185/#286과
--  동일한 재번호 관례. stage·production 두 DB에는 이미 원래 이름(299_admin_push_new_chat_
--  session)으로 schema_migrations에 기록·적용 완료된 상태 — 이 파일 재번호는 로컬 파일
--  이력 정리 목적이며 이미 적용된 DB 상태에는 영향 없음)
-- 배경: /cms/chat 신규 채팅 세션 발생 시 관리자 브라우저 푸시알림이 없다는 지적 —
--       조사 결과 기존 관리자 푸시(#182/#183, new_reservation/contract_signed/
--       payment_completed 3종)에 애초에 상담(채팅) 이벤트가 없었음(연동 끊김이 아니라 미구현).
--       기존 인프라(get_admin_push_recipients/update_admin_notify_setting)를 그대로 확장.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_new_session BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.admin_notify_new_session IS '관리자 푸시: 고객 신규 상담(채팅) 세션 시작 시 수신 여부 (기본: 수신)';

-- get_admin_push_recipients — 'new_session' 분기 추가
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
      WHEN 'new_reservation'   THEN admin_notify_new_reservation
      WHEN 'contract_signed'   THEN admin_notify_contract_signed
      WHEN 'payment_completed' THEN admin_notify_payment_completed
      WHEN 'new_session'       THEN admin_notify_new_session
      ELSE false
    END;
END;
$$;

-- update_admin_notify_setting — 'new_session' 분기 추가
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
  IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed', 'new_session') THEN
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
  ELSE
    UPDATE user_profiles SET admin_notify_new_session = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rollback:
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS admin_notify_new_session;
-- (get_admin_push_recipients / update_admin_notify_setting은 #183 정의로 CREATE OR REPLACE 필요)
