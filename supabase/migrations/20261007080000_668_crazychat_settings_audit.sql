-- Migration 668: 크레이지챗 설정 변경 감사 + 갱신 시각 자동 기록 (S5, 2026-10-07, Stephen 승인)
--   1) cms_admin_audit_log.action_type 허용값에 'crazychat_setting_change' 추가(기존 값 전부 유지)
--   2) crazychat_settings 갱신 시 updated_at 자동 기록(DB에서 직접 바꾼 경우까지) — updated_by는 변경 API가 채운다
-- 롤백: DROP TRIGGER trg_crazychat_settings_touch ON public.crazychat_settings; DROP FUNCTION private.crazychat_settings_touch();
--       CHECK는 'crazychat_setting_change'를 뺀 목록으로 재생성.

ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'role_change', 'create', 'delete', 'suspend', 'menu_permission_change', 'concurrent_login_change',
    'session_limit_change', 'name_change', 'password_recovery_issued', 'password_recovery_completed', 'doc_view',
    'crazychat_setting_change'
  ]::text[]));

CREATE OR REPLACE FUNCTION private.crazychat_settings_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_crazychat_settings_touch ON public.crazychat_settings;
CREATE TRIGGER trg_crazychat_settings_touch
  BEFORE UPDATE ON public.crazychat_settings
  FOR EACH ROW EXECUTE FUNCTION private.crazychat_settings_touch();

-- 트리거 전용 함수는 직접 호출 권한을 주지 않는다(§23 서버 전용 함수 권한 원칙) — 트리거 실행은 영향받지 않는다
REVOKE ALL ON FUNCTION private.crazychat_settings_touch() FROM PUBLIC, anon, authenticated;
