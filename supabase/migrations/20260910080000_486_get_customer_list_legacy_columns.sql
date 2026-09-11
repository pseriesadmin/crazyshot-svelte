-- Migration 486: get_customer_list RPC에 레거시 클레임 컬럼 5종 추가
--
-- 배경(2026-09-10 GATE E 재검수로 발견): CustomerDetailPanel.svelte의 "레거시 미인증" 배지가
-- row.legacy_imported_at을 참조하지만, CMS 고객목록을 채우는 get_customer_list RPC(Migration
-- #410, 2026-09-01)는 legacy_* 컬럼 자체가 신설(Migration #483, 2026-09-10)되기 이전에
-- 작성돼 이 컬럼들을 전혀 SELECT하지 않는다 — row.legacy_imported_at이 항상 undefined라
-- 배지가 영구히 렌더링될 수 없는 죽은 코드였다.
--
-- 함께 수정: 배지의 "인증완료 여부" 판정 기준이던 user_profiles.password_set은 2026-07-13
-- 1회성 백필 이후 어떤 라이브 코드도 갱신하지 않는 stale 컬럼이라(Migration 485 배경 설명과
-- 동일한 이유) legacy_claimed_at으로 대체한다 — 이번에 함께 SELECT에 추가.
--
-- RETURNS TABLE 시그니처가 바뀌므로 DROP 후 재생성 필요(PostgreSQL 제약).

DROP FUNCTION IF EXISTS public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]);

CREATE FUNCTION public.get_customer_list(
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
  withdrawal_purge_at timestamp with time zone,
  legacy_imported_at timestamp with time zone,
  legacy_claimed_at timestamp with time zone,
  legacy_source text,
  legacy_signup_at timestamp with time zone,
  legacy_purchase_count integer
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
    up.withdrawal_purge_at,
    up.legacy_imported_at,
    up.legacy_claimed_at,
    up.legacy_source::TEXT,
    up.legacy_signup_at,
    up.legacy_purchase_count
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

REVOKE ALL ON FUNCTION public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]) TO service_role;
