-- Migration #361: get_customer_list — 본인증명/외국인증명 다중파일 배열 노출 수정
-- 배경: CMS 고객상세(CustomerDetailPanel.svelte) "본인 증명"·"외국인 증명" 노출 반영 검증
-- 중 발견 — migration 359/360으로 identity_doc_url/identity_type이 TEXT[]로, foreign_doc_urls/
-- foreign_type/foreign_stay_type이 신규 TEXT[]/TEXT 컬럼으로 확장됐으나, get_customer_list()는
-- 여전히 identity_doc_url/identity_type을 ::TEXT로 배열을 강제 캐스팅해 반환하고 있어(Postgres
-- 배열 리터럴 문자열 "{url1,url2}" 형태로 뭉개짐) 실제로 본인증명을 등록한 고객도 CMS에는
-- "미등록"으로 오표시되거나(라벨 매칭 실패), 뷰어를 열면 깨진 문자열이 그대로 로드됐다
-- (Production 실고객 2명에게 이미 영향, 2026-08-27 직접 SQL 조회로 확인). foreign_doc_urls/
-- foreign_type/foreign_stay_type은 아예 반환 목록에서 누락돼 있어 외국인증명 다중 파일은
-- CMS에서 전혀 노출되지 않았다(legacy foreign_doc_url 첫 파일만 노출).
--
-- 반환 타입(RETURNS TABLE) 컬럼 타입/개수가 바뀌므로 DROP 후 재생성한다(products.md §2-3/
-- Migration #345·346·360과 동일 이유 — CREATE OR REPLACE는 반환 타입 변경 불가).
-- SELECT 로직·필터·정렬·grant 대상(service_role 전용)은 기존과 완전히 동일, identity_type/
-- identity_doc_url을 배열 그대로 반환 + foreign_doc_urls/foreign_type/foreign_stay_type
-- 3개 컬럼만 추가한 것 외 변경 없음.

DROP FUNCTION IF EXISTS get_customer_list(integer, integer, text, text, boolean, uuid);

CREATE FUNCTION get_customer_list(
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
  p_search text DEFAULT NULL::text,
  p_membership_grade text DEFAULT NULL::text,
  p_blacklisted boolean DEFAULT NULL::boolean,
  p_user_id uuid DEFAULT NULL::uuid
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
  birth_date date
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
    up.birth_date
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
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) TO service_role;

COMMENT ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) IS
  'CMS 고객 목록/상세 조회. identity_doc_url·identity_type은 배열(TEXT[])로 그대로 반환
   (더 이상 ::TEXT 캐스팅 없음 — migration 359로 컬럼이 배열로 확장됐기 때문).
   foreign_doc_urls·foreign_type·foreign_stay_type 신규 컬럼 포함(migration 360). service_role 전용.';
