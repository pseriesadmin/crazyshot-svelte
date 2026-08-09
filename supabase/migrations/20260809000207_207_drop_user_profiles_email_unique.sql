-- Migration #207: user_profiles_email_key UNIQUE 제약 제거
-- 원인: 동일 이메일로 재가입 시 handle_new_user 트리거가 ON CONFLICT (id) DO NOTHING으로
--       처리하지만, email UNIQUE 제약에서 23505(duplicate key) 오류 발생 → Auth signup 500
-- 해결: user_profiles.email UNIQUE 제약 제거
--       (auth.users.email이 이미 unique를 보장하므로 user_profiles에서 중복 제약 불필요)

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_email_key;
