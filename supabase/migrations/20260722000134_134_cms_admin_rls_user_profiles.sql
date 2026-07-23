-- migration #134: CMS 관리자 user_profiles 전체 조회 RLS
-- CMS 관리자(cms_role IS NOT NULL)가 모든 고객 프로필을 SELECT할 수 있도록 허용
-- Dependencies: 03_user_profiles.sql

-- 1. 재귀 방지용 SECURITY DEFINER 헬퍼 함수
CREATE OR REPLACE FUNCTION public.is_cms_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_cms_admin() TO authenticated;

-- 2. CMS 관리자 전체 조회 정책 추가 (기존 본인 조회 정책과 OR 적용)
CREATE POLICY "user_profiles: cms 관리자 전체 조회"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (is_cms_admin());
