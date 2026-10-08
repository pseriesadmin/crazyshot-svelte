-- Migration 666: 관리자 푸시 이벤트 'crazychat_request'(크레이지챗 접수 알림) 신설 (2026-10-07, Stephen 확정 — S3 Q3-A)
--
-- 크레이지챗이 고객의 예약 시간 변경·연장 요청을 접수하면 관리자에게 푸시로 알린다(관리자 전용 알림은 chat_messages가 아니라
-- 푸시·CMS 카드로 — service-operations.md §17). 관리자 푸시 허브(sendPushToAdmins)는 알려진 이벤트 키만 수신자로 인식하므로
-- Migration 631(identity_review)과 같은 방식으로 DB에도 등록한다.
--
-- 변경: ① user_profiles.admin_notify_crazychat_request(기본 true — 기존 이벤트와 동일한 기본값)
--       ② get_admin_push_recipients에 'crazychat_request' 분기 추가
--       ③ update_admin_notify_setting(CMS 푸시 설정 화면 토글 저장)에 같은 키 허용
-- 두 함수 본문은 Stage·Production 현행 정의(2026-10-07 조회, 두 DB 해시 동일 = Migration 631 정의)에 분기 1개씩만 추가했다.
-- 롤백: 두 함수를 631 정의로 되돌리고 컬럼은 DROP COLUMN admin_notify_crazychat_request.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_crazychat_request BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_profiles.admin_notify_crazychat_request IS
  '관리자 푸시 수신 설정 — 크레이지챗이 고객 요청(예약 시간 변경·연장)을 접수했을 때 푸시(이벤트 crazychat_request). cms_role 보유자에게만 의미 있음.';

CREATE OR REPLACE FUNCTION public.get_admin_push_recipients(p_event_key text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      WHEN 'identity_review'        THEN admin_notify_identity_review
      WHEN 'crazychat_request'      THEN admin_notify_crazychat_request
      ELSE false
    END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_admin_notify_setting(p_target_user_id uuid, p_event_key text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed', 'new_session', 'urgent_chat_message', 'identity_review', 'crazychat_request') THEN
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
  ELSIF p_event_key = 'identity_review' THEN
    UPDATE user_profiles SET admin_notify_identity_review = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSIF p_event_key = 'crazychat_request' THEN
    UPDATE user_profiles SET admin_notify_crazychat_request = p_enabled
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
$function$;

-- rollback: 두 함수를 Migration 631 본문으로 되돌린 뒤
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS admin_notify_crazychat_request;
