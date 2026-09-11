-- Migration #488: check_email_registered SECURITY DEFINER RPC
-- 목적: 이메일 중복 여부를 anon/authenticated 클라이언트에서 확인할 수 있도록
--       RLS를 우회하는 SECURITY DEFINER 함수 제공 (boolean 반환만 — 개인정보 미노출)

CREATE OR REPLACE FUNCTION public.check_email_registered(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE email = p_email
    AND deleted_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_registered(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_registered(TEXT) TO anon, authenticated;
