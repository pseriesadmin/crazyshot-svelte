-- Migration #689: 푸시알림 설정 — 알림별 안내문장 저장 (push_notification_config.extra_config.message)
--
-- 목적: /cms/set/push 에서 알림 유형별 안내문장을 편집한다. 같은 문장이 푸시와 문자(Solapi)에 함께 반영된다.
--  - 저장 위치: push_notification_config.extra_config 의 'message' 키(비어 있으면 코드의 기본 문구 사용).
--  - 기존 update_push_notification_config 는 p_extra_config 를 통째로 교체(COALESCE)하므로 쓰지 않고,
--    'message' 키만 병합/삭제하는 전용 함수를 둔다(다른 키 보존).
--  - 감사로그(cms_admin_audit_log) action_type 에 'push_message_change' 추가.
--
-- 서버 전용 함수: anon·authenticated 명시 REVOKE 후 service_role 에만 GRANT (service-operations.md §23).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.update_push_notification_message(text, text);
--   ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT cms_admin_audit_log_action_type_check;
--   ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type = ANY (ARRAY[
--     'role_change','create','delete','suspend','menu_permission_change','concurrent_login_change','session_limit_change',
--     'name_change','password_recovery_issued','password_recovery_completed','doc_view','crazychat_setting_change']));

CREATE OR REPLACE FUNCTION public.update_push_notification_message(
  p_notify_type text,
  p_message     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_msg text := NULLIF(btrim(COALESCE(p_message, '')), '');
BEGIN
  IF p_notify_type IS NULL OR p_notify_type = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'notify_type_required');
  END IF;

  IF v_msg IS NOT NULL AND char_length(v_msg) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_too_long');
  END IF;

  IF v_msg IS NULL THEN
    -- 빈 문자열 = 기본 문구 복원(키 삭제)
    UPDATE push_notification_config
       SET extra_config = COALESCE(extra_config, '{}'::jsonb) - 'message',
           updated_at   = NOW(),
           updated_by   = auth.uid()
     WHERE notify_type = p_notify_type;
  ELSE
    UPDATE push_notification_config
       SET extra_config = jsonb_set(COALESCE(extra_config, '{}'::jsonb), '{message}', to_jsonb(v_msg), true),
           updated_at   = NOW(),
           updated_by   = auth.uid()
     WHERE notify_type = p_notify_type;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'notify_type_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_push_notification_message(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_push_notification_message(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_push_notification_message(text, text) TO service_role;

ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'role_change', 'create', 'delete', 'suspend', 'menu_permission_change', 'concurrent_login_change', 'session_limit_change',
  'name_change', 'password_recovery_issued', 'password_recovery_completed', 'doc_view', 'crazychat_setting_change',
  'push_message_change'
]));
