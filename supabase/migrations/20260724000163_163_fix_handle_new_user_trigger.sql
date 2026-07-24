-- Migration #163: handle_new_user 트리거 함수 user_id 누락 버그 수정
-- 원인: 기존 함수가 (id, email)만 INSERT → user_id NOT NULL 위반 → 신규 가입 시 user_profiles 미생성
-- 수정: INSERT 컬럼에 user_id 추가 (id와 동일한 auth.users.id 값)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- 익명 로그인은 user_profiles 생성 스킵
  IF NEW.is_anonymous IS TRUE THEN
    RETURN NEW;
  END IF;

  -- id = user_id = auth.users.id (동일 UUID 사용)
  INSERT INTO public.user_profiles (id, user_id, email)
  VALUES (NEW.id, NEW.id, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users INSERT 후 user_profiles 자동 생성. id와 user_id 모두 auth.users.id로 설정.';
