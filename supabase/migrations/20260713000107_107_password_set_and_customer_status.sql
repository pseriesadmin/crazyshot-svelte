-- Migration #107: 예비고객/정식회원 구분 컬럼 추가 + get_customer_list 확장
-- 목적: 비밀번호 미설정 예비고객과 정식 회원을 구분하는 password_set 플래그
--       예약 폼 가입(예비고객) → 재방문 비밀번호 설정 → 정식회원 전환 플로우 지원
-- 2026-07-13

-- 1. password_set 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.password_set IS
  '비밀번호 설정 여부: false=예비고객(예약 폼 가입, 로그인 불가) | true=정식회원(비밀번호 설정 완료)';

-- 2. 기존 정식 회원 일괄 업데이트
--    auth.users에 encrypted_password가 존재하는 사용자 → password_set = true
UPDATE user_profiles up
SET password_set = true
FROM auth.users au
WHERE up.id = au.id
  AND au.encrypted_password IS NOT NULL
  AND au.encrypted_password != ''
  AND up.deleted_at IS NULL;

-- 3. get_customer_list RPC 재생성: password_set 필드 추가
DROP FUNCTION IF EXISTS get_customer_list(TEXT, TEXT, BOOLEAN, INT, INT);

CREATE FUNCTION get_customer_list(
  p_search           TEXT    DEFAULT NULL,
  p_membership_grade TEXT    DEFAULT NULL,
  p_blacklisted      BOOLEAN DEFAULT NULL,
  p_page             INT     DEFAULT 1,
  p_limit            INT     DEFAULT 50
)
RETURNS TABLE (
  user_id              UUID,
  email                TEXT,
  phone                TEXT,
  name                 TEXT,
  member_code          TEXT,
  member_type          TEXT,
  membership_grade     TEXT,
  credit_score         SMALLINT,
  rental_count         INT,
  late_return_count    INT,
  damage_count         INT,
  points               INT,
  blacklisted          BOOLEAN,
  blacklist_reason     TEXT,
  is_student           BOOLEAN,
  is_foreign           BOOLEAN,
  identity_type        TEXT,
  identity_doc_url     TEXT,
  identity_verified_at TIMESTAMPTZ,
  password_set         BOOLEAN,
  created_at           TIMESTAMPTZ,
  total_count          BIGINT,
  cms_role             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset INT := (p_page - 1) * p_limit;
BEGIN
  RETURN QUERY
  SELECT
    up.id                    AS user_id,
    up.email::TEXT,
    up.phone::TEXT,
    up.full_name::TEXT       AS name,
    up.member_code::TEXT,
    up.member_type::TEXT,
    up.membership_grade::TEXT,
    up.credit_score,
    up.rental_count,
    up.late_return_count,
    up.damage_count,
    up.points,
    up.blacklisted,
    up.blacklist_reason::TEXT,
    up.is_student,
    up.is_foreign,
    up.identity_type::TEXT,
    up.student_doc_url::TEXT AS identity_doc_url,
    up.student_verified_at   AS identity_verified_at,
    up.password_set,
    up.created_at,
    COUNT(*) OVER()          AS total_count,
    up.cms_role::TEXT
  FROM user_profiles up
  WHERE up.deleted_at IS NULL
    AND (
      p_search IS NULL OR p_search = '' OR (
        up.full_name ILIKE '%' || p_search || '%'
        OR up.email  ILIKE '%' || p_search || '%'
        OR up.phone  ILIKE '%' || p_search || '%'
      )
    )
    AND (
      p_membership_grade IS NULL OR p_membership_grade = ''
      OR up.membership_grade = p_membership_grade
    )
    AND (p_blacklisted IS NULL OR up.blacklisted = p_blacklisted)
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION get_customer_list(TEXT, TEXT, BOOLEAN, INT, INT) IS
  '관리자 전용: 전체 회원 목록 페이지네이션. password_set(예비고객/정식회원) 포함.';
