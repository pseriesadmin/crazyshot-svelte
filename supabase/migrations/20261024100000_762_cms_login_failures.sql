-- Migration #762: CMS 로그인 실패 기록 표 + 감사로그 이벤트 확장 (2026-10-24 권한 감사 3번, Stephen 지시)
-- 목적: ① 같은 계정·같은 접속지에서 비밀번호를 반복해서 틀리면 서버가 로그인 시도를 막는다(CMS 로그인은 서버 액션이라 앱 차원에서 제한 가능)
--       ② 새 환경(처음 보는 접속지+브라우저)에서 관리자 로그인이 성공하면 감사로그에 남기고 계정 주인에게 알린다.
-- 이메일은 해시로만 저장(원문 이메일·비밀번호는 저장하지 않는다). 서버(service_role) 전용 표 — RLS 켜고 정책 0건, 로그인 사용자·비로그인에는 권한을 주지 않는다.
CREATE TABLE IF NOT EXISTS public.cms_login_failures (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  ip_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_login_failures_email_idx ON public.cms_login_failures (email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS cms_login_failures_ip_idx ON public.cms_login_failures (ip_address, created_at DESC);

ALTER TABLE public.cms_login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_login_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_login_failures TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cms_login_failures_id_seq TO service_role;

-- 감사로그 이벤트에 새 환경 로그인 추가(기존 값 전부 유지)
ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'role_change','create','delete','suspend','menu_permission_change','concurrent_login_change','session_limit_change','name_change',
  'password_recovery_issued','password_recovery_completed','doc_view','crazychat_setting_change','push_message_change','nlsearch_setting_change',
  'login_new_environment'
]::text[]));

-- ROLLBACK: DROP TABLE public.cms_login_failures; (감사로그 CHECK 는 login_new_environment 기록이 없을 때만 이전 값으로 되돌릴 수 있다)
