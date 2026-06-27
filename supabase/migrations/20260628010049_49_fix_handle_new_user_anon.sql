-- 49_fix_handle_new_user_anon.sql
-- handle_new_user() 트리거: 익명 유저(email=NULL) 가입 시 500 에러 수정
-- 원인: user_profiles.email NOT NULL 제약 + 익명 유저 email = NULL → INSERT 실패
-- 수정: 익명 유저는 user_profiles INSERT 스킵 (chat_sessions는 auth.uid 직접 사용)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 익명 유저(email 없음)는 user_profiles 행 불필요
  IF NEW.is_anonymous IS TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
