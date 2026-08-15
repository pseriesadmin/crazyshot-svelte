-- Migration #261: get_customer_list — p_user_id 단건 조회 파라미터 추가
--
-- 배경: /cms/subscriptions "구독자현황" 탭 ↔ /cms/customers 고객상세 "구독이력" 탭 상호
-- 딥링크 연결. /cms/customers?selected=<user_id> 로 진입할 때, 검색/필터/페이지네이션과
-- 무관하게 특정 고객 1명을 정확히 조회해야 한다(딥링크 대상이 현재 페이지 밖에 있을 수 있음).
-- get_customer_list의 계산된 컬럼(rental_count 등)을 그대로 재사용하기 위해 별도 쿼리를
-- 새로 만들지 않고 이 RPC에 선택적 파라미터만 추가한다(단일 소스 유지).
--
-- ADD-ONLY: 기존 migration 165 파일은 수정하지 않음. p_user_id는 DEFAULT NULL이라 기존
-- 호출부(검색/페이지네이션)는 전부 그대로 동작.
--
-- ⚠️ 파라미터 개수가 5→6으로 변경되므로 DROP 후 재생성 필수 — CREATE OR REPLACE만 쓰면 기존
-- 5-param 함수가 남은 채 6-param 함수가 별도로 생겨 PostgREST 오버로드 모호성(PGRST203) 발생
-- (products.md §2-3 generate_subscription_product_code 사례와 동일 교훈).
--
-- 🔴 긴급 보안수정 동봉: DROP 직전 실측 확인 결과 이 함수가 anon/authenticated 키로 이미
-- `/rest/v1/rpc/get_customer_list` 직접 호출이 가능한 상태였다(REVOKE 이력 전무, migration
-- 98/110/139/165 어디에도 GRANT/REVOKE 없음 — 프로젝트 기본 권한 설정에 의존한 채 방치).
-- 이 RPC는 전체 고객의 이메일·전화번호·신분증 URL·블랙리스트 사유까지 포함해 반환하므로 익명
-- 접근 시 심각한 개인정보 유출이다. 이번 마이그레이션이 이 함수를 어차피 DROP 후 재생성하는
-- 김에(재생성 시 권한이 초기화되므로 방치하면 동일 노출이 반복됨) service_role 전용으로 함께
-- 잠근다 — 딥링크 기능과 별개의 발견이지만 같은 함수를 다루는 작업이라 분리하지 않음.

DROP FUNCTION IF EXISTS public.get_customer_list(INT, INT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_customer_list(
  p_page              INT     DEFAULT 1,
  p_limit             INT     DEFAULT 20,
  p_search            TEXT    DEFAULT NULL,
  p_membership_grade  TEXT    DEFAULT NULL,
  p_blacklisted       BOOLEAN DEFAULT NULL,
  p_user_id           UUID    DEFAULT NULL
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
  foreign_doc_url      TEXT,
  foreign_verified_at  TIMESTAMPTZ,
  password_set         BOOLEAN,
  created_at           TIMESTAMPTZ,
  total_count          BIGINT,
  cms_role             TEXT,
  birth_date           DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
    up.identity_doc_url::TEXT,
    up.identity_verified_at,
    up.foreign_doc_url::TEXT,
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
$$;

REVOKE ALL ON FUNCTION public.get_customer_list(INT, INT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_customer_list(INT, INT, TEXT, TEXT, BOOLEAN, UUID) TO service_role;

COMMENT ON FUNCTION public.get_customer_list(INT, INT, TEXT, TEXT, BOOLEAN, UUID) IS
  'CMS 관리자 전용(service_role) — 전체 고객 PII(이메일·전화번호·신분증 URL 등) 포함, anon/
   authenticated 실행 금지. p_user_id 지정 시 검색/필터/페이지네이션 무시하고 해당 고객
   1명만 반환(딥링크 단건 조회용).';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 165 원본으로 되돌림(p_user_id 파라미터·필터 3곳 제거, REVOKE/GRANT/COMMENT 제거):
-- DROP FUNCTION IF EXISTS public.get_customer_list(INT, INT, TEXT, TEXT, BOOLEAN, UUID);
-- CREATE OR REPLACE FUNCTION public.get_customer_list(
--   p_page INT DEFAULT 1, p_limit INT DEFAULT 20, p_search TEXT DEFAULT NULL,
--   p_membership_grade TEXT DEFAULT NULL, p_blacklisted BOOLEAN DEFAULT NULL
-- ) ... (migration 165 본문 그대로 복원, 권한은 프로젝트 기본값으로 되돌아감)
-- ============================================================
