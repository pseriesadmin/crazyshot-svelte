-- Migration 746 — 기존 회원 인증 조회·가입 이메일 중복 확인 보완 (2026-10-23)
--
-- 배경: 기존 고객이 "찾을 수 없음" / "이미 가입한 아이디" 로 막히는 사례 점검 결과
--  ① find_legacy_member 이름 비교가 앞뒤 공백만 무시해서 "김 철수"와 "김철수"가 다르게 취급됨
--  ② check_email_registered 가 user_profiles 만 봐서, 로그인 계정(auth.users)에는 남아 있는데 프로필이 삭제 처리된 이메일은
--     화면에서 "사용 가능"으로 보이다가 가입 마지막에 "이미 가입된 이메일"로 실패함
-- 두 함수 모두 시그니처·권한은 그대로(CREATE OR REPLACE는 기존 권한을 보존하지만 아래에서 명시적으로 다시 지정).

-- ① 이름 비교: 모든 공백 무시 + 대소문자 무시
CREATE OR REPLACE FUNCTION find_legacy_member(
  p_name  TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row legacy_member_staging%ROWTYPE;
BEGIN
  SELECT *
  INTO   v_row
  FROM   public.legacy_member_staging
  WHERE  UPPER(REGEXP_REPLACE(full_name, '\s', '', 'g')) = UPPER(REGEXP_REPLACE(p_name, '\s', '', 'g'))
    AND  phone                  = p_phone
    AND  claimed_at             IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'staging_id',             v_row.id::text,
    'email',                  v_row.email,
    'name',                   v_row.full_name,
    'phone',                  v_row.phone,
    'legacy_source',          v_row.legacy_source,
    'legacy_signup_at',       v_row.legacy_signup_at,
    'legacy_purchase_count',  v_row.legacy_purchase_count,
    'legacy_imported_at',     v_row.imported_at
  );
END;
$$;

REVOKE ALL ON FUNCTION find_legacy_member(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) TO service_role;

-- ② 이메일 중복 확인: 프로필(삭제 안 된 것) 또는 로그인 계정(auth.users) 어느 쪽에든 있으면 사용 불가. 대소문자 무시.
CREATE OR REPLACE FUNCTION public.check_email_registered(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE lower(email) = lower(p_email)
      AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(p_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_registered(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_registered(TEXT) TO anon, authenticated;

-- ── ROLLBACK(참고용) ──
-- #490(find_legacy_member)·#488(check_email_registered) 본문으로 되돌린다.
