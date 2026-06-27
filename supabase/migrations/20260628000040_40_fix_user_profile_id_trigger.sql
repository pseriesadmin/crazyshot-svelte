-- 40_fix_user_profile_id_trigger.sql
-- 배경: stage DB user_profiles 스키마가 로컬 마이그레이션과 다름
--   - id = auth.users.id (직접 PK, user_id 컬럼 없음)
--   - full_name (name 아님)
-- 수정:
--   1. auth.users → user_profiles 자동 생성 트리거 생성
--   2. 이용희 user_profiles 행 생성 (등록 시 트리거 미존재로 누락)

-- 1. 트리거 함수
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. 이용희 user_profiles 행 복원
INSERT INTO public.user_profiles (id, email, full_name, phone, cms_role, cms_allow_concurrent_login)
VALUES (
  '463abdae-d8ab-4fd3-a0f4-c7a84dde777d',
  'lyh025@naver.com',
  '이용희',
  '010-7334-2012',
  'manager',
  true
)
ON CONFLICT (id) DO UPDATE SET
  full_name                  = EXCLUDED.full_name,
  phone                      = EXCLUDED.phone,
  cms_role                   = EXCLUDED.cms_role,
  cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;
