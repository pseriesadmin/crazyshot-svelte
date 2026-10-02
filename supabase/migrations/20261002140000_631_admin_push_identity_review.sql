-- Migration #631: 관리자 푸시 이벤트 'identity_review'(본인증명정보 등록 확인 요청) 신설 (2026-10-02, Stephen 확정)
--
-- 배경: 고객이 필수 본인증명정보(또는 외국인증명)를 등록 완료하면 관리자 상담 세션에 admin_only
-- "등록 확인 요청" 카드(identity_review_request)가 쌓이지만 관리자 푸시는 나가지 않아, 관리자가 상담
-- 화면을 열어두지 않으면 승인이 지연됐다. 기존 관리자 푸시 허브(sendPushToAdmins)는 알려진 5개 이벤트만
-- 수신자로 인식(그 외 키는 ELSE false)하므로 새 이벤트를 DB 쪽에도 등록해야 한다.
--
-- 변경: ① user_profiles.admin_notify_identity_review(기본 true — 기존 5개 이벤트와 동일한 기본값)
--       ② get_admin_push_recipients에 'identity_review' 분기 추가
--       ③ update_admin_notify_setting(CMS 푸시 설정 화면 토글 저장)에 같은 키 허용
-- 두 함수 본문은 Stage·Production 현행 정의(2026-10-02 조회, 동일)에 분기 1개씩만 추가했다.
-- 롤백: 두 함수를 이전 본문으로 되돌리고 컬럼은 DROP COLUMN admin_notify_identity_review.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_identity_review BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_profiles.admin_notify_identity_review IS
  '관리자 푸시 수신 설정 — 고객 본인증명정보(필수 조합) 등록 완료 시 승인 요청 푸시(이벤트 identity_review). cms_role 보유자에게만 의미 있음.';

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
  IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed', 'new_session', 'urgent_chat_message', 'identity_review') THEN
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

-- rollback: (실행 순서대로 — 함수 먼저 #481 정의로 되돌린 뒤 컬럼 삭제)
-- CREATE OR REPLACE FUNCTION public.get_admin_push_recipients(p_event_key text)
--  RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   RETURN QUERY
--   SELECT id FROM user_profiles
--   WHERE cms_role IS NOT NULL
--     AND CASE p_event_key
--       WHEN 'new_reservation'        THEN admin_notify_new_reservation
--       WHEN 'contract_signed'        THEN admin_notify_contract_signed
--       WHEN 'payment_completed'      THEN admin_notify_payment_completed
--       WHEN 'new_session'            THEN admin_notify_new_session
--       WHEN 'urgent_chat_message'    THEN admin_notify_urgent_chat_message
--       ELSE false
--     END;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.update_admin_notify_setting(p_target_user_id uuid, p_event_key text, p_enabled boolean)
--  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed', 'new_session', 'urgent_chat_message') THEN
--     RETURN jsonb_build_object('ok', false, 'error', 'invalid_event_key');
--   END IF;
--   IF p_event_key = 'new_reservation' THEN
--     UPDATE user_profiles SET admin_notify_new_reservation = p_enabled WHERE id = p_target_user_id AND cms_role IS NOT NULL;
--   ELSIF p_event_key = 'contract_signed' THEN
--     UPDATE user_profiles SET admin_notify_contract_signed = p_enabled WHERE id = p_target_user_id AND cms_role IS NOT NULL;
--   ELSIF p_event_key = 'payment_completed' THEN
--     UPDATE user_profiles SET admin_notify_payment_completed = p_enabled WHERE id = p_target_user_id AND cms_role IS NOT NULL;
--   ELSIF p_event_key = 'new_session' THEN
--     UPDATE user_profiles SET admin_notify_new_session = p_enabled WHERE id = p_target_user_id AND cms_role IS NOT NULL;
--   ELSE
--     UPDATE user_profiles SET admin_notify_urgent_chat_message = p_enabled WHERE id = p_target_user_id AND cms_role IS NOT NULL;
--   END IF;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'admin_not_found'); END IF;
--   RETURN jsonb_build_object('ok', true);
-- END;
-- $function$;
--
-- ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS admin_notify_identity_review;
