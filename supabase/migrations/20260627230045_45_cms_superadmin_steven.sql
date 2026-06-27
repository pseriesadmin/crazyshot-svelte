-- 45_cms_superadmin_steven.sql
-- CMS 역할 정본:
--   superadmin → steven@pseries.net (슈퍼마스터, 계정·전체 CMS)
--   manager    → lyh025@naver.com (하위 매니저, 40번 마이그레이션)
-- 배경: stage 로그인 시 Auth 성공 후 cms_role NULL → 403 차단

INSERT INTO public.user_profiles (id, email, full_name, cms_role, cms_allow_concurrent_login)
VALUES (
  '2ebd8b93-723f-4aa7-8472-47dae46a6380',
  'steven@pseries.net',
  'Stephen',
  'superadmin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  email                      = EXCLUDED.email,
  cms_role                   = 'superadmin',
  cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;
