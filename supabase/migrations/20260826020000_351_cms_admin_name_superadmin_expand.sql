-- Migration #351: CMS 관리자 이름수정 RPC 신설 + superadmin 허용값 확장
--
-- .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 4
--
-- 변경 1: cms_update_admin_name — 이름 수정 RPC (Stage 4 공백 해소)
--          기존에 이름 수정 기능 자체가 없었음 (§조사결과 D)
-- 변경 2: cms_setup_admin_profile — IN 허용값에 'superadmin' 추가 (시그니처 변경 없음)
-- 변경 3: cms_update_admin_role   — IN 허용값에 'superadmin' 추가 (시그니처 변경 없음)
-- 모든 함수: SECURITY DEFINER, service_role 전용 (anon/authenticated 실행권한 제거 유지)

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. cms_update_admin_name (신규)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_update_admin_name(
  p_user_id   UUID,
  p_full_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'invalid_name: full_name must not be empty';
  END IF;
  UPDATE user_profiles SET full_name = trim(p_full_name) WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_update_admin_name(UUID, TEXT)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. cms_setup_admin_profile — 'superadmin' 허용값 추가 (CREATE OR REPLACE, 시그니처 동일)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_setup_admin_profile(
  p_user_id                UUID,
  p_full_name              TEXT,
  p_phone                  TEXT,
  p_cms_role               TEXT,
  p_allow_concurrent_login BOOLEAN,
  p_session_timeout_hours  INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cms_role NOT IN ('manager', 'partner', 'superadmin') THEN
    RAISE EXCEPTION 'invalid_cms_role: must be manager, partner, or superadmin';
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. cms_update_admin_role — 'superadmin' 허용값 추가 (CREATE OR REPLACE, 시그니처 동일)
-- ──────────────────────────────────────────────────────────────────────────────
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
  IF p_cms_role NOT IN ('manager', 'partner', 'superadmin') THEN
    RAISE EXCEPTION 'invalid_cms_role: must be manager, partner, or superadmin';
  END IF;

  UPDATE user_profiles SET cms_role = p_cms_role WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_update_admin_role(UUID, TEXT)
  FROM anon, authenticated;
