-- Migration #135: CMS 고객 패널에 생년월일 추가
-- get_customer_list → birth_date 반환 추가
-- update_customer_info → p_birth_date 파라미터 추가
-- 2026-07-22

-- 1. get_customer_list: birth_date 컬럼 추가
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
  cms_role           TEXT,
  birth_date         DATE
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
    up.cms_role::TEXT,
    up.birth_date
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
  '관리자 전용: 전체 회원 목록 페이지네이션. cms_role(관리자 배지), birth_date 포함.';

-- 2. update_customer_info: p_birth_date 파라미터 추가
DROP FUNCTION IF EXISTS update_customer_info(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);

CREATE FUNCTION update_customer_info(
  p_user_id      UUID,
  p_name         TEXT         DEFAULT NULL,
  p_email        TEXT         DEFAULT NULL,
  p_phone        TEXT         DEFAULT NULL,
  p_member_type  TEXT         DEFAULT NULL,
  p_created_at   TIMESTAMPTZ  DEFAULT NULL,
  p_birth_date   DATE         DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET
    full_name   = CASE WHEN p_name        IS NOT NULL THEN p_name        ELSE full_name   END,
    email       = CASE WHEN p_email       IS NOT NULL THEN p_email       ELSE email       END,
    phone       = CASE WHEN p_phone       IS NOT NULL THEN p_phone       ELSE phone       END,
    member_type = CASE WHEN p_member_type IS NOT NULL THEN p_member_type ELSE member_type END,
    created_at  = CASE WHEN p_created_at  IS NOT NULL THEN p_created_at  ELSE created_at  END,
    birth_date  = CASE WHEN p_birth_date  IS NOT NULL THEN p_birth_date  ELSE birth_date  END,
    updated_at  = NOW()
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사용자를 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_info TO authenticated;
