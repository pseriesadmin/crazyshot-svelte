-- 43_cms_admin_rpcs.sql
-- CMS 관리자 계정 CRUD 전용 RPC 함수
-- H-01/H-02 ESLint 가드레일 준수: 서버 코드에서 .insert()/.update() 직접 호출 대신 RPC 경유
-- 모든 함수 SECURITY DEFINER + anon/authenticated 실행 권한 제거 (service_role 전용)

-- ──────────────────────────────────────────────
-- 1. cms_setup_admin_profile
--    계정 생성 직후 user_profiles에 CMS 설정값 기록
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_setup_admin_profile(
  p_user_id               UUID,
  p_full_name             TEXT,
  p_phone                 TEXT,
  p_cms_role              TEXT,
  p_allow_concurrent_login BOOLEAN,
  p_session_timeout_hours  INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cms_role NOT IN ('manager', 'partner') THEN
    RAISE EXCEPTION 'invalid_cms_role: must be manager or partner';
  END IF;

  UPDATE user_profiles SET
    full_name                  = p_full_name,
    phone                      = p_phone,
    cms_role                   = p_cms_role,
    cms_allow_concurrent_login = p_allow_concurrent_login,
    cms_session_timeout_hours  = p_session_timeout_hours
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_setup_admin_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 2. cms_create_invite_token
--    admin_invite_tokens 레코드 삽입 후 token 값 반환
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_create_invite_token(
  p_created_by UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  INSERT INTO admin_invite_tokens (created_by)
  VALUES (p_created_by)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_create_invite_token(UUID)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 3. cms_update_admin_phone
--    휴대번호 수정
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_update_admin_phone(
  p_user_id UUID,
  p_phone   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles SET phone = p_phone WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_update_admin_phone(UUID, TEXT)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 4. cms_update_admin_role
--    접근 권한 변경 (manager | partner 만 허용)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_update_admin_role(
  p_user_id  UUID,
  p_cms_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cms_role NOT IN ('manager', 'partner') THEN
    RAISE EXCEPTION 'invalid_cms_role: must be manager or partner';
  END IF;

  UPDATE user_profiles SET cms_role = p_cms_role WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_update_admin_role(UUID, TEXT)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 5. cms_toggle_concurrent_login
--    중복 로그인 허용 토글 (현재 값을 반전)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_toggle_concurrent_login(
  p_user_id UUID,
  p_current BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET cms_allow_concurrent_login = NOT p_current
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_toggle_concurrent_login(UUID, BOOLEAN)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 6. cms_toggle_session_limit
--    세션 제한 토글 (제한 있음→null, 없음→24h)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_toggle_session_limit(
  p_user_id  UUID,
  p_has_limit BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET cms_session_timeout_hours = CASE WHEN p_has_limit THEN NULL ELSE 24 END
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_toggle_session_limit(UUID, BOOLEAN)
  FROM anon, authenticated;
