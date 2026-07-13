-- Migration #103: get_customer_list에 cms_role 컬럼 추가
-- 목적: 고객목록에서 관리자 계정을 완전 제외하지 않고,
--       cms_role 값을 함께 반환해 프런트에서 배지로 구분
-- 정책:
--   모든 계정은 user_profiles 기준 고객으로 분류
--   cms_role IS NOT NULL 계정은 고객목록에 "관리자" 배지 표시
--   관리자 계정목록(설정>계정관리)은 별도 유지
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_customer_list(TEXT, TEXT, BOOLEAN, INT, INT);

CREATE FUNCTION get_customer_list(
  p_search           TEXT    DEFAULT NULL,
  p_membership_grade TEXT    DEFAULT NULL,
  p_blacklisted      BOOLEAN DEFAULT NULL,
  p_page             INT     DEFAULT 1,
  p_limit            INT     DEFAULT 50
)
RETURNS TABLE (
  user_id            UUID,
  email              TEXT,
  phone              TEXT,
  name               TEXT,
  member_code        TEXT,
  member_type        TEXT,
  membership_grade   TEXT,
  credit_score       SMALLINT,
  rental_count       INT,
  late_return_count  INT,
  damage_count       INT,
  points             INT,
  blacklisted        BOOLEAN,
  blacklist_reason   TEXT,
  is_student         BOOLEAN,
  is_foreign         BOOLEAN,
  created_at         TIMESTAMPTZ,
  total_count        BIGINT,
  cms_role           TEXT       -- 관리자 배지용: NULL이면 일반 고객
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
    up.id                  AS user_id,
    up.email::TEXT,
    up.phone::TEXT,
    up.full_name::TEXT     AS name,
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
    up.created_at,
    COUNT(*) OVER()        AS total_count,
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
  '관리자 전용: 전체 회원 목록 페이지네이션. cms_role 값 포함 — NULL이면 일반 고객, 값 있으면 관리자 배지 표시.';
