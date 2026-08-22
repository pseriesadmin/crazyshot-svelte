-- Migration #326: CMS 관리자 로그인 로그 테이블
-- 보안 강화: 로그인 성공 시 IP·브라우저·시각·역할 기록

CREATE TABLE IF NOT EXISTS public.cms_login_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  email        TEXT        NOT NULL,
  cms_role     TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  logged_in_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS 활성화 (service_role 전용 INSERT, 일반 세션 접근 차단)
ALTER TABLE public.cms_login_logs ENABLE ROW LEVEL SECURITY;

-- 조회 인덱스
CREATE INDEX IF NOT EXISTS cms_login_logs_user_idx ON public.cms_login_logs(user_id);
CREATE INDEX IF NOT EXISTS cms_login_logs_at_idx   ON public.cms_login_logs(logged_in_at DESC);
