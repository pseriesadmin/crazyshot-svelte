-- 690_audit_action_nlsearch_setting_change.sql
-- A-4(2026-10-10): CMS "검색 설정" 변경을 cms_admin_audit_log에 남기기 위해 action_type 허용 목록에 'nlsearch_setting_change' 추가.
-- 기존 허용 값은 그대로 두고 1개만 더한다(적용 전 Stage·Production의 현재 제약 정의를 확인해 기존 값을 빠뜨리지 않을 것).
-- 롤백: 같은 제약을 'nlsearch_setting_change' 없이 다시 만든다(이미 기록된 행이 있으면 먼저 처리 필요).
ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'role_change','create','delete','suspend','menu_permission_change','concurrent_login_change',
    'session_limit_change','name_change','password_recovery_issued','password_recovery_completed',
    'doc_view','crazychat_setting_change','push_message_change','nlsearch_setting_change'
  ]::text[]));
