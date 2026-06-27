-- 48_user_profiles_self_select_by_id.sql
-- CMS 로그인: service_role 없이 본인 cms_role 조회 허용 (stage 스키마 id = auth.uid())
-- Dependencies: 03_user_profiles, 34_admin_cms_rls

DROP POLICY IF EXISTS "user_profiles: 본인 조회 by id" ON user_profiles;
CREATE POLICY "user_profiles: 본인 조회 by id" ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());
