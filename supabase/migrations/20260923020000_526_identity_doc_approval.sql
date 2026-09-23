-- Migration #526: 본인증명/외국인증명 "관리자 승인" 단계 신설
--
-- 배경(Stephen 요청): 고객이 /account/profile에서 본인증명·외국인증명 서류를 등록해도
-- 관리자가 검토·확인했다는 개념이 지금까지 DB에 전혀 없었다. identity_verified_at/
-- foreign_verified_at은 "제출 시각"만 의미하며(customer-facing update_user_doc_url RPC,
-- migration #495가 매 제출마다 무조건 NOW()로 갱신), CMS 고객패널·CS채팅 사이드바·고객
-- 본인 프로필 3개 화면이 전부 이 시각을 "완료" 표시로만 쓴다 — 관리자 승인 게이트가 아님.
-- 기존 *_verified_at은 절대 재정의하지 않고(3개 화면의 "제출 완료" 표시 의미를 깨뜨리므로),
-- 새 컬럼 identity_approved_at/foreign_approved_at을 나란히 추가한다.
--
-- "검토 대기" 판정식: *_verified_at IS NOT NULL AND (*_approved_at IS NULL
--   OR *_approved_at < *_verified_at) — 승인 후 재제출 시 자동으로 다시 대기 상태가 됨.
--
-- get_customer_list 반환 컬럼이 늘어나므로 CREATE OR REPLACE 불가(Postgres 제약,
-- 반환타입 변경 시 DROP 필수 — migration #364/#486과 동일 사유) → DROP 후 재생성.
-- ⛔ migration #364에서 이미 한 번 사고가 난 지점: DROP+CREATE 시 REVOKE ALL FROM
--    PUBLIC/anon/authenticated를 반드시 함께 재적용해야 한다 — 빠뜨리면 Postgres 기본값인
--    "신규 함수는 PUBLIC에 EXECUTE 자동 부여"로 인해 고객 PII(이메일·전화번호·본인증명
--    문서 URL 등)가 다시 anon/authenticated에 노출된다. 이번 마이그레이션은 최신 정의인
--    migration #486(20260910080000)을 그대로 베이스로 사용한다 — #410을 베이스로 삼지 않음
--    (#486이 #410보다 나중이며 legacy_* 컬럼 5종을 이미 포함하고 있음).

-- ─────────────────────────────────────────────────────────────
-- 1. user_profiles 신규 컬럼
-- ─────────────────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS identity_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS foreign_approved_at  TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.identity_approved_at IS
  '관리자가 본인증명 서류를 승인한 시각. identity_verified_at(제출 시각)과 별개 —
   NULL이거나 identity_verified_at보다 이전이면 "검토 대기" 상태(migration #526).';
COMMENT ON COLUMN user_profiles.foreign_approved_at IS
  '관리자가 외국인증명 서류를 승인한 시각. foreign_verified_at(제출 시각)과 별개 —
   NULL이거나 foreign_verified_at보다 이전이면 "검토 대기" 상태(migration #526).';

-- ─────────────────────────────────────────────────────────────
-- 2. approve_customer_doc RPC — p_user_id = user_profiles.id (toggle_blacklist와 동일 관례)
--    handle_new_user 트리거(migration #163)가 id=user_id=auth.users.id로 항상 동일하게
--    생성하므로 실질적으로 auth.uid()/user_profiles.user_id와도 값이 같다.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_customer_doc(
  p_user_id  UUID,
  p_doc_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_verified_at  TIMESTAMPTZ;
  v_approved_at  TIMESTAMPTZ := NOW();
BEGIN
  IF p_doc_type NOT IN ('identity', 'foreign') THEN
    RETURN jsonb_build_object('ok', false, 'error', '잘못된 문서 유형입니다.');
  END IF;

  IF p_doc_type = 'identity' THEN
    SELECT identity_verified_at INTO v_verified_at FROM user_profiles WHERE id = p_user_id;
  ELSE
    SELECT foreign_verified_at INTO v_verified_at FROM user_profiles WHERE id = p_user_id;
  END IF;

  IF v_verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '제출된 문서가 없습니다.');
  END IF;

  IF p_doc_type = 'identity' THEN
    UPDATE user_profiles SET identity_approved_at = v_approved_at WHERE id = p_user_id;
  ELSE
    UPDATE user_profiles SET foreign_approved_at = v_approved_at WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'approved_at', v_approved_at);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_customer_doc(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_customer_doc(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.approve_customer_doc(UUID, TEXT) IS
  'CMS 관리자가 고객의 본인증명/외국인증명 서류를 승인 처리. service_role 전용 —
   호출부(POST /api/cms/approve-doc)가 getCmsRoleForAction+hasSettingsAccess로 사전 게이트.
   제출 이력(identity_verified_at/foreign_verified_at) 없으면 실패 반환(migration #526).';

-- ─────────────────────────────────────────────────────────────
-- 3. get_customer_list — DROP 후 재생성 (베이스: migration #486 최신 정의 + 신규 컬럼 2개)
-- ─────────────────────────────────────────────────────────────

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
  legacy_purchase_count integer,
  identity_approved_at timestamp with time zone,
  foreign_approved_at timestamp with time zone
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
    up.legacy_purchase_count,
    up.identity_approved_at,
    up.foreign_approved_at
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

COMMENT ON FUNCTION public.get_customer_list(integer, integer, text, text, boolean, uuid, text[]) IS
  'CMS 고객 목록/상세 조회. service_role 전용 — anon/authenticated/PUBLIC 실행 권한 없음
   (migration #364 정책, 매 DROP+CREATE 후 REVOKE 재적용 필수). migration #526에서
   identity_approved_at/foreign_approved_at(관리자 승인 시각) 2개 컬럼 추가.';

-- ─────────────────────────────────────────────────────────────
-- 4. push_notification_config 시드 — 본인증명/외국인증명 승인 완료 고객 푸시
--    (선택. sendPushToUser는 config 행이 없으면 기본적으로 발송 허용하므로 필수는 아니나,
--    contract_sent(migration #220)와 동일하게 CMS 푸시 설정 화면에서 토글 가능하도록 등록)
-- ─────────────────────────────────────────────────────────────

insert into push_notification_config (category, notify_type, label, push_enabled)
values ('customer_lifecycle', 'identity_approved', '본인증명/외국인증명 승인 완료', true)
on conflict (notify_type) do nothing;

-- rollback:
-- delete from push_notification_config where notify_type = 'identity_approved';
-- DROP FUNCTION IF EXISTS public.approve_customer_doc(UUID, TEXT);
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS identity_approved_at, DROP COLUMN IF EXISTS foreign_approved_at;
-- (get_customer_list 롤백은 migration #486 본문을 그대로 재실행)
