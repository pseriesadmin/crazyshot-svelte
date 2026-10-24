-- Migration #755: 로그인 계정(auth.users) 이메일이 바뀌면 프로필(user_profiles.email)을 자동으로 맞춘다 (2026-10-24)
--
-- 배경: handle_new_user 트리거는 auth.users INSERT에만 걸려 있고, 임시(익명)→정식 전환·이메일 확정·이메일 변경은 UPDATE라
--       프로필 이메일이 갱신되지 않았다(#702는 가입 화면이 ensure_user_profile을 호출하는 순간에만 채움). 계정 이메일이 확정되는 시점이
--       그 호출보다 늦거나(확인 대기) 서버가 따로 확정하면 프로필 이메일이 빈 채로 남아 CMS 목록 공란·비밀번호 찾기 불일치가 생겼다.
-- 규칙: 계정 이메일이 실제로 바뀐 순간(비어 있지 않은 값) 프로필 이메일을 그 값으로 맞춘다. 프로필 갱신 실패는 인증 처리를 막지 않는다
--       (예외를 경고로만 남김 — 이 트리거 때문에 로그인·가입이 실패하면 안 된다).
-- 권한: 트리거 함수는 서버 내부 전용(SECURITY DEFINER, 실행 권한은 소유자만).

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    BEGIN
      UPDATE public.user_profiles
         SET email = NEW.email
       WHERE id = NEW.id
         AND COALESCE(email, '') IS DISTINCT FROM NEW.email;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_profile_email_from_auth: % (user %)', SQLERRM, NEW.id;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- 이미 어긋난 계정 보정(계정엔 이메일이 있는데 프로필이 빈 경우만 — 값이 있는 프로필은 건드리지 않음). 2026-10-24 기준 Production 0건·Stage 0건.
UPDATE public.user_profiles up
   SET email = au.email
  FROM auth.users au
 WHERE au.id = up.id
   AND COALESCE(au.email, '') <> ''
   AND COALESCE(up.email, '') = '';

-- ── 롤백 ──
-- DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
-- DROP FUNCTION IF EXISTS public.sync_profile_email_from_auth();
