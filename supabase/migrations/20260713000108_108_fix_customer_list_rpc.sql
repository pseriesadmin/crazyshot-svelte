-- Migration #108: get_customer_list RPC 수정
-- 원인: student_doc_url / student_verified_at 컬럼이 user_profiles에 없음
--       → NULL로 대체하여 identity_doc_url / identity_verified_at 반환
-- 2026-07-13

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
    up.id                       AS user_id,
    up.email::TEXT,
    up.phone::TEXT,
    up.full_name::TEXT          AS name,
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
    NULL::TEXT                  AS identity_doc_url,
    NULL::TIMESTAMPTZ           AS identity_verified_at,
    up.password_set,
    up.created_at,
    COUNT(*) OVER()             AS total_count,
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
  '관리자 전용: 전체 회원 목록 페이지네이션. identity_doc_url/verified_at은 향후 컬럼 추가 시 연동 예정.';
