-- 47_cms_superadmin_steven_profile_fix.sql
-- steven@pseries.net superadmin — user_id / id 양쪽 스키마 호환
-- Dependencies: 34 (cms_role 컬럼)

DO $$
DECLARE
  v_auth_id uuid := '2ebd8b93-723f-4aa7-8472-47dae46a6380';
  v_email   text := 'steven@pseries.net';
  v_has_user_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'user_id'
  ) INTO v_has_user_id;

  IF v_has_user_id THEN
    UPDATE public.user_profiles SET
      cms_role                   = 'superadmin',
      cms_allow_concurrent_login = true
    WHERE user_id = v_auth_id OR email = v_email;

    IF NOT FOUND THEN
      INSERT INTO public.user_profiles (user_id, email, name, cms_role, cms_allow_concurrent_login)
      VALUES (v_auth_id, v_email, 'Stephen', 'superadmin', true)
      ON CONFLICT (user_id) DO UPDATE SET
        cms_role                   = 'superadmin',
        cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;
    END IF;
  ELSE
    INSERT INTO public.user_profiles (id, email, full_name, cms_role, cms_allow_concurrent_login)
    VALUES (v_auth_id, v_email, 'Stephen', 'superadmin', true)
    ON CONFLICT (id) DO UPDATE SET
      email                      = EXCLUDED.email,
      cms_role                   = 'superadmin',
      cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;
  END IF;
END;
$$;
