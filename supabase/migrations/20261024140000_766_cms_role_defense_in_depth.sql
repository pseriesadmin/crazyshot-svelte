-- Migration #766: 관리자 등급(cms_role) 이중 방어 — 등급 변경 차단 트리거 + 남은 수정 정책 삭제 + 임시(익명) 로그인 계정은 관리자로 인정하지 않음
-- (2026-10-24, sp5 A-Lite SEC-002·SEC-005, 2026-10-30 Supabase 신규 테이블 권한 정책 변경 전 보강)
--
-- 배경: user_profiles 의 관리자 등급 변경 차단이 #289 의 표 단위 UPDATE 권한 회수 한 겹뿐이었다.
--       운영에는 정책 user_profiles_update(USING auth.uid() = id, WITH CHECK 없음)가 남아 있어, 권한 일괄 부여(GRANT)로 UPDATE 가 다시 열리면
--       아무 로그인(임시 로그인 포함) 계정이 자기 cms_role 을 'superadmin' 으로 바꿀 수 있다.
--       또 is_cms_user 등 판정 함수는 "프로필에 cms_role 이 있으면 관리자"만 봐서 임시(익명) 계정을 거르지 않았다.
-- 변경:
--   ① user_profiles BEFORE INSERT OR UPDATE 트리거 — 호출 역할이 anon·authenticated(클라이언트 직접 요청)일 때 cms_role 을 넣거나 바꾸면 거절(42501).
--      SECURITY DEFINER 함수(소유자 postgres)·service_role·SQL 에디터는 영향 없음 → 서버의 정식 경로(cms_setup_admin_profile 등)는 그대로 동작.
--   ② 정책 user_profiles_update 삭제 — 클라이언트 직접 수정은 어차피 권한이 없고(#289), 본인 수정은 update_user_profile RPC(DEFINER)로 이뤄진다. 정책이 없으면 권한이 다시 열려도 RLS 가 UPDATE 를 거절한다.
--   ③ is_cms_user·is_cms_admin·is_cms_manager_or_above 에 임시(익명) 로그인 제외 조건 추가 — JWT 의 is_anonymous 클레임이 참이면 거짓. 정식 가입 계정은 영향 없음.
-- 영향 없음 확인: 앱 코드에 클라이언트가 user_profiles 를 직접 수정/삽입하는 곳이 없다(#759 확인), 관리자 계정은 이메일 정식 가입 계정이다.

-- ① 트리거
CREATE OR REPLACE FUNCTION public.user_profiles_guard_cms_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.cms_role IS NOT NULL THEN
        RAISE EXCEPTION 'forbidden: cms_role can only be set by the server' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.cms_role IS DISTINCT FROM OLD.cms_role THEN
      RAISE EXCEPTION 'forbidden: cms_role can only be changed by the server' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_profiles_guard_cms_role() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_profiles_guard_cms_role ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_guard_cms_role
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_guard_cms_role();

-- ② 남은 수정 정책 삭제
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;

-- ③ 임시(익명) 로그인 계정은 관리자로 인정하지 않는다 (CREATE OR REPLACE 는 기존 실행 권한을 유지한다)
CREATE OR REPLACE FUNCTION public.is_cms_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     AND EXISTS (
       SELECT 1 FROM user_profiles
       WHERE id = auth.uid() AND cms_role IS NOT NULL
     );
$function$;

CREATE OR REPLACE FUNCTION public.is_cms_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     AND EXISTS (
       SELECT 1 FROM user_profiles
       WHERE id = auth.uid() AND cms_role IS NOT NULL
     );
$function$;

CREATE OR REPLACE FUNCTION public.is_cms_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     AND EXISTS (
       SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
     );
$function$;

-- ROLLBACK (되돌리면 권한이 다시 열릴 때 임시 로그인 계정이 관리자가 될 수 있다 — 하지 말 것):
--   DROP TRIGGER IF EXISTS trg_user_profiles_guard_cms_role ON public.user_profiles;
--   DROP FUNCTION IF EXISTS public.user_profiles_guard_cms_role();
--   CREATE POLICY user_profiles_update ON public.user_profiles FOR UPDATE USING (auth.uid() = id);   -- 운영에만 있던 정책
--   is_cms_user / is_cms_admin / is_cms_manager_or_above 는 아래 이전 정의(적용 직전 Production 에서 조회한 값, LANGUAGE sql · STABLE · SECURITY DEFINER · SET search_path TO 'public')로 CREATE OR REPLACE:
--     is_cms_user, is_cms_admin : SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IS NOT NULL);
--     is_cms_manager_or_above   : SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin'));
-- (2026-10-25 주석만 보강 — SQL 본문은 Stage·Production 적용분과 동일)
