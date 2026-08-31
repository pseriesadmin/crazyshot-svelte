-- Migration #410: get_customer_list() 인증분류 필터 대소문자 비교 버그 수정
--
-- 배경: Migration 409가 p_classifications 필터를 추가하면서 up.membership_grade를 소문자
-- 'none'과 비교했다. 그러나 membership_grade는 항상 대문자로 저장된다
-- (Migration 98 CHECK 제약: 'NONE'|'EASY'|'POP'|'CRAZY', 실측 984/984행 전부 'NONE').
-- Postgres 문자열 비교는 대소문자를 구분하므로:
--   'subscriber' 분기 — membership_grade IS DISTINCT FROM 'none' → 'NONE' ≠ 'none'이라 항상 TRUE
--     → 실제로는 구독 등급이 전혀 없는 고객까지 전부 "구독" 분류로 매칭됨
--   'general' 분기   — membership_grade IS NOT DISTINCT FROM 'none' → 'NONE' ≠ 'none'이라 항상 FALSE
--     → is_student=false인 고객이 압도적 다수인데도 "일반" 필터가 단 한 명도 매칭하지 못함
--       (실사용 중 "일반 칩 선택 시 목록이 전혀 안 나온다"는 형태로 발견)
-- 동일한 대소문자 버그가 프론트 클라이언트 코드(+page.svelte, CustomerDetailPanel.svelte의
-- classificationsOf())에도 있었으나 그건 별도로 이미 수정됨 — 이번 마이그레이션은 SQL측만 수정.
--
-- 함수 시그니처(파라미터·반환 컬럼) 전부 무변경 — WHERE절 문자열 리터럴 2곳만 대문자로 정정.
-- CREATE OR REPLACE만으로 충분(DROP 불필요, 반환타입 변경 없음) — 기존 GRANT/REVOKE(service_role
-- 전용) 그대로 보존됨.

CREATE OR REPLACE FUNCTION public.get_customer_list(
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
  p_search text DEFAULT NULL::text,
  p_membership_grade text DEFAULT NULL::text,
  p_blacklisted boolean DEFAULT NULL::boolean,
  p_user_id uuid DEFAULT NULL::uuid,
  p_classifications text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  user_id uuid, email text, phone text, name text, member_code text, member_type text,
  membership_grade text, credit_score smallint, rental_count integer, late_return_count integer,
  damage_count integer, points integer, blacklisted boolean, blacklist_reason text,
  is_student boolean, is_foreign boolean,
  identity_type text[], identity_doc_url text[], identity_verified_at timestamp with time zone,
  foreign_doc_url text, foreign_doc_urls text[], foreign_type text[], foreign_stay_type text,
  foreign_verified_at timestamp with time zone,
  password_set boolean, created_at timestamp with time zone, total_count bigint,
  cms_role text, birth_date date,
  withdrawal_status text, withdrawal_requested_at timestamp with time zone,
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
        OR ('subscriber' = ANY(p_classifications) AND up.membership_grade IS DISTINCT FROM 'NONE')
        OR ('general'    = ANY(p_classifications) AND up.is_student = false
            AND up.membership_grade IS NOT DISTINCT FROM 'NONE')
      )
    )
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$function$;

COMMENT ON FUNCTION public.get_customer_list(integer, integer, text, text, boolean, uuid, text[]) IS
  'CMS 고객 목록/상세 조회. service_role 전용. p_classifications 필터는 membership_grade를
   대문자(NONE/EASY/POP/CRAZY) 기준으로 비교한다(migration 410 — 409의 소문자 비교 버그 수정).';
