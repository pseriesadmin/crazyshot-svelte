-- 46_cms_superadmin_steven_auth.sql
-- steven@pseries.net CMS 슈퍼마스터 Auth(비밀번호) + 프로필 보장
-- Dependencies: 01_extensions (pgcrypto), 40 (user_profiles trigger), 45 (cms_role)
--
-- 역할 정본:
--   superadmin → steven@pseries.net
--   manager    → lyh025@naver.com (40번)
--
-- ▶ crazyshot-stage SQL Editor 실행 (2단계):
--   ① 비밀번호 설정 (8자 이상, git에 저장하지 말 것)
--      SELECT set_config('app.cms_superadmin_password', '원하는비밀번호', false);
--   ② 이 파일 전체 실행
--
-- ▶ supabase db push / CI:
--   - auth.users에 steven 계정이 이미 있으면 비밀번호 설정 없이 통과 (NOTICE만)
--   - 계정이 없으면 app.cms_superadmin_password 필수

DO $$
DECLARE
  v_seed_id   uuid := '2ebd8b93-723f-4aa7-8472-47dae46a6380';
  v_user_id   uuid;
  v_email     text := 'steven@pseries.net';
  v_password  text := nullif(trim(current_setting('app.cms_superadmin_password', true)), '');
  v_encrypted text;
  v_exists    boolean;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email OR id = v_seed_id
  LIMIT 1;

  v_user_id := COALESCE(v_user_id, v_seed_id);

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id)
  INTO v_exists;

  IF NOT v_exists AND (v_password IS NULL OR length(v_password) < 8) THEN
    RAISE EXCEPTION
      'steven@pseries.net auth.users 행 없음 — SQL Editor에서 먼저 실행: '
      'SELECT set_config(''app.cms_superadmin_password'', ''8자이상비밀번호'', false);';
  END IF;

  IF v_password IS NOT NULL AND length(v_password) >= 8 THEN
    v_encrypted := crypt(v_password, gen_salt('bf'));
  END IF;

  IF v_exists THEN
    IF v_encrypted IS NOT NULL THEN
      UPDATE auth.users SET
        encrypted_password = v_encrypted,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at         = now()
      WHERE id = v_user_id;
    ELSE
      RAISE NOTICE 'steven@pseries.net exists — password unchanged (set app.cms_superadmin_password to rotate)';
    END IF;
  ELSE
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Stephen"}'::jsonb,
      now(),
      now(),
      ''
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_email,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  END IF;

  INSERT INTO public.user_profiles (id, email, full_name, cms_role, cms_allow_concurrent_login)
  VALUES (v_user_id, v_email, 'Stephen', 'superadmin', true)
  ON CONFLICT (id) DO UPDATE SET
    email                      = EXCLUDED.email,
    cms_role                   = 'superadmin',
    cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;

  -- v5.46 스키마 (user_id 컬럼 존재 시)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.user_profiles SET
      cms_role                   = 'superadmin',
      cms_allow_concurrent_login = true
    WHERE user_id = v_user_id OR email = v_email;

    IF NOT FOUND THEN
      INSERT INTO public.user_profiles (user_id, email, name, cms_role, cms_allow_concurrent_login)
      VALUES (v_user_id, v_email, 'Stephen', 'superadmin', true)
      ON CONFLICT (user_id) DO UPDATE SET
        cms_role                   = 'superadmin',
        cms_allow_concurrent_login = EXCLUDED.cms_allow_concurrent_login;
    END IF;
  END IF;
END;
$$;
