-- Migration #376: get_customer_list — 탈회 상태 컬럼 3개 추가 (G4)
-- (원래 #373으로 작성됐으나 다른 병렬 세션의 #373/#374/#375와 파일명 번호가 연쇄 충돌해
-- #376으로 재번호. Stage DB에는 apply_migration 시점의 내부 버전으로 이미 별도 적용되어
-- 있어 실제 DB 충돌은 없었음 — 저장소 파일명 정리 목적의 재명명, 2026-08-29)
-- 배경: Migration 365에서 user_profiles에 withdrawal_status / withdrawal_requested_at /
-- withdrawal_purge_at 컬럼이 추가됐으나, CMS 고객목록 RPC get_customer_list()가 이 컬럼들을
-- 반환하지 않아 CMS에서 탈회 배지를 표시할 데이터가 없는 상태. 반환 타입(RETURNS TABLE)에
-- 컬럼을 추가하므로 CREATE OR REPLACE 불가 — DROP 후 재생성(Migration 361/364 선례와 동일).
--
-- 변경 내용: RETURNS TABLE 맨 끝에 3개 추가 + SELECT 절 맨 끝에 3개 추가.
-- SELECT 로직·WHERE 절·ORDER BY·LIMIT/OFFSET·파라미터 시그니처는 Migration 361과 완전히 동일.
-- WHERE up.deleted_at IS NULL 필터를 유지함으로써 탈회 회원(withdrawal_status='requested')이
-- 자동으로 목록에 계속 노출됨(탈회가 deleted_at을 건드리지 않으므로 — 이것이 요구사항 충족 방법).
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
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$function$;

-- ⛔ 보안 필수: DROP+재생성 시 Postgres가 PUBLIC에 EXECUTE를 자동 부여하므로
-- 반드시 REVOKE 후 service_role만 GRANT (Migration 364 사고 재발 방지)
REVOKE ALL ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) TO service_role;

COMMENT ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) IS
  'CMS 고객 목록/상세 조회. service_role 전용 — anon/authenticated/PUBLIC 실행 권한 없음.
   identity_doc_url·identity_type은 배열(TEXT[]) 그대로 반환(migration 361).
   foreign_doc_urls·foreign_type·foreign_stay_type 포함(migration 360).
   withdrawal_status·withdrawal_requested_at·withdrawal_purge_at 포함(migration 373/365).
   WHERE deleted_at IS NULL 유지 — 탈회 회원(withdrawal_status=''requested'')은 목록에 계속 노출됨.';
