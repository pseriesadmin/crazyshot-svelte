-- Migration #409: get_customer_list — 인증분류(일반/학생/구독) 다중선택 필터 추가
-- 배경: CMS 고객목록(/cms/customers) 필터칩이 membership_grade(none/easy/pop/crazy) 값을
-- 그대로 노출하고 있었으나, Stephen 확인 결과 easy/pop/crazy는 "고객 등급"이 아니라 정기구독
-- 상품 티어이고 실제 고객 분류는 인증 상태 기준 일반/학생/구독 3종이다(2026-09-01 확정).
--   - 구독: membership_grade IS DISTINCT FROM 'none' (Stephen 확정 — easy/pop/crazy 어느 티어든 구독 중)
--   - 학생: is_student = true
--   - 일반: 학생도 구독자도 아닌 기본 상태
-- 한 고객이 학생이면서 동시에 구독자일 수 있다(Stephen 확정 — 배지·필터 둘 다 복수 선택/표시
-- 허용, 우선순위 없음) — 새 파라미터는 OR 매칭(선택된 분류 중 하나라도 해당하면 매치)이다.
--
-- 기존 p_membership_grade 파라미터는 그대로 유지(하위호환, 다른 호출부 영향 없음 확인 완료) —
-- 신규 p_classifications(text[])만 추가. SELECT 로직·기타 WHERE 절·ORDER BY·페이지네이션은
-- Migration 376과 완전히 동일.
--
-- 보안: Migration 364 사고(DROP+재생성 시 PUBLIC EXECUTE 자동 부여 재발) 재방지를 위해
-- 이 파일 맨 끝에 반드시 REVOKE ALL ... FROM PUBLIC, anon, authenticated를 명시.

DROP FUNCTION IF EXISTS get_customer_list(integer, integer, text, text, boolean, uuid);

CREATE FUNCTION get_customer_list(
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
  p_search text DEFAULT NULL::text,
  p_membership_grade text DEFAULT NULL::text,
  p_blacklisted boolean DEFAULT NULL::boolean,
  p_user_id uuid DEFAULT NULL::uuid,
  p_classifications text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  user_id uuid,
  email text,
  phone text,
  name text,
  member_code text,
  member_type text,
  membership_grade text,
  credit_score smallint,
  rental_count integer,
  late_return_count integer,
  damage_count integer,
  points integer,
  blacklisted boolean,
  blacklist_reason text,
  is_student boolean,
  is_foreign boolean,
  identity_type text[],
  identity_doc_url text[],
  identity_verified_at timestamp with time zone,
  foreign_doc_url text,
  foreign_doc_urls text[],
  foreign_type text[],
  foreign_stay_type text,
  foreign_verified_at timestamp with time zone,
  password_set boolean,
  created_at timestamp with time zone,
  total_count bigint,
  cms_role text,
  birth_date date,
  withdrawal_status text,
  withdrawal_requested_at timestamp with time zone,
  withdrawal_purge_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    up.identity_type,
    up.identity_doc_url,
    up.identity_verified_at,
    up.foreign_doc_url::TEXT,
    up.foreign_doc_urls,
    up.foreign_type,
    up.foreign_stay_type::TEXT,
    up.foreign_verified_at,
    up.password_set,
    up.created_at,
    COUNT(*) OVER()             AS total_count,
    up.cms_role::TEXT,
    up.birth_date,
    up.withdrawal_status::TEXT,
    up.withdrawal_requested_at,
    up.withdrawal_purge_at
  FROM user_profiles up
  WHERE up.deleted_at IS NULL
    AND (p_user_id IS NULL OR up.id = p_user_id)
    AND (
      p_user_id IS NOT NULL OR p_search IS NULL OR p_search = '' OR (
        up.full_name ILIKE '%' || p_search || '%'
        OR up.email  ILIKE '%' || p_search || '%'
        OR up.phone  ILIKE '%' || p_search || '%'
      )
    )
    AND (
      p_user_id IS NOT NULL OR p_membership_grade IS NULL OR p_membership_grade = ''
      OR up.membership_grade = p_membership_grade
    )
    AND (p_user_id IS NOT NULL OR p_blacklisted IS NULL OR up.blacklisted = p_blacklisted)
    AND (
      p_user_id IS NOT NULL OR p_classifications IS NULL
      OR array_length(p_classifications, 1) IS NULL
      OR (
        ('student'    = ANY(p_classifications) AND up.is_student = true)
        OR ('subscriber' = ANY(p_classifications) AND up.membership_grade IS DISTINCT FROM 'none')
        OR ('general'    = ANY(p_classifications) AND up.is_student = false
            AND up.membership_grade IS NOT DISTINCT FROM 'none')
      )
    )
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$function$;

-- ⛔ 보안 필수: DROP+재생성 시 Postgres가 PUBLIC에 EXECUTE를 자동 부여하므로
-- 반드시 REVOKE 후 service_role만 GRANT (Migration 364 사고 재발 방지)
REVOKE ALL ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid, text[]) TO service_role;

COMMENT ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid, text[]) IS
  'CMS 고객 목록/상세 조회. service_role 전용 — anon/authenticated/PUBLIC 실행 권한 없음.
   identity_doc_url·identity_type은 배열(TEXT[]) 그대로 반환(migration 361).
   foreign_doc_urls·foreign_type·foreign_stay_type 포함(migration 360).
   withdrawal_status·withdrawal_requested_at·withdrawal_purge_at 포함(migration 373/365).
   p_classifications(text[]) — ''general''|''student''|''subscriber'' 다중선택 OR 필터
   (migration 409, 2026-09-01). p_membership_grade는 하위호환 유지.
   WHERE deleted_at IS NULL 유지 — 탈회 회원(withdrawal_status=''requested'')은 목록에 계속 노출됨.';
