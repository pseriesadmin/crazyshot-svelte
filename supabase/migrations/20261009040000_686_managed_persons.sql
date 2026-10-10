-- Migration #686: 고객목록 '관리대상 등록' — 회원 가입 이력 없는 인물을 관리자가 직접 등록
--
-- 배경(Stephen 2026-10-09): 고객목록 툴바에 '관리대상 등록' 버튼 신설. 관리자가 가입 이력이 없는 인물의
-- 이름·전화번호·사유를 직접 등록하면 즉시 '관리대상'으로 분류되고, 회원 QR 체계(member_code)로 전용 QR을 발급한다.
-- user_profiles는 auth.users FK·email NOT NULL이라 비회원 행을 넣을 수 없어 별도 테이블로 분리한다
-- (#489 legacy_member_staging 격리 선례와 같은 방향 — service_role 전용 RLS 테이블).
--
-- 변경:
--   1) managed_persons 테이블(RLS ON·정책 0건 — service_role만 접근)
--   2) cms_register_managed_person / cms_update_managed_person / cms_delete_managed_person (service_role 전용 RPC)
--   3) get_customer_list — 비회원 갈래 UNION + is_managed_person 컬럼 추가 (DROP→CREATE→REVOKE 재적용, #364 정책)
-- 채번: generate_member_code('B2C', true, 'MG') → 'CSMG{YYMM}{seq}' — 접두어 'MG'로 기존 회원코드(BC/BB·설정 접두어)와 번호 공간 분리.
--   ⚠️ /cms/customers/settings의 회원코드 접두어를 'MG'로 설정하면 같은 시퀀스를 공유한다 — 'MG'는 관리대상 전용으로 예약.
--
-- 롤백(참고):
--   1) DROP FUNCTION public.get_customer_list(integer,integer,text,text,boolean,uuid,text[]);
--      → supabase/migrations/20260923020000_526_identity_doc_approval.sql 3절(get_customer_list 정의 + REVOKE 4줄)을 그대로 재실행해 복원
--   2) DROP FUNCTION public.cms_register_managed_person(text,text,text,date,text,uuid);
--      DROP FUNCTION public.cms_update_managed_person(uuid,text,text,text,date,text);
--      DROP FUNCTION public.cms_delete_managed_person(uuid,uuid);
--      DROP FUNCTION public.private_managed_phone_digits(text);
--      DROP FUNCTION public.private_managed_phone_display(text);
--   3) DROP TABLE public.managed_persons;   -- 등록된 관리대상 데이터가 함께 사라진다(필요 시 먼저 백업)

-- ─────────────────────────────────────────────────────────────
-- 1. managed_persons
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.managed_persons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text NOT NULL,
  phone_digits text NOT NULL,
  email        text,
  birth_date   date,
  reason       text NOT NULL,
  member_code  text NOT NULL UNIQUE,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid
);

-- 같은 전화번호의 활성 관리대상 중복 방지(삭제된 행은 제외)
CREATE UNIQUE INDEX IF NOT EXISTS uq_managed_persons_phone_active
  ON public.managed_persons (phone_digits) WHERE deleted_at IS NULL;

ALTER TABLE public.managed_persons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.managed_persons FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.managed_persons IS
  '회원 가입 이력 없는 관리대상 인물(관리자 직접 등록). RLS ON·정책 0건 — service_role 전용. 고객목록(get_customer_list)에 UNION 노출. migration #686.';

-- ─────────────────────────────────────────────────────────────
-- 2. 등록 / 수정 / 삭제 RPC (service_role 전용 — 호출부가 manager 이상 게이트)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private_managed_phone_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d LIKE '82%' AND length(d) >= 11 THEN '0' || substr(d, 3)
    ELSE d
  END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) s
$$;

CREATE OR REPLACE FUNCTION private_managed_phone_display(p_digits text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(p_digits) = 11 THEN substr(p_digits,1,3) || '-' || substr(p_digits,4,4) || '-' || substr(p_digits,8,4)
    WHEN length(p_digits) = 10 AND p_digits LIKE '02%' THEN substr(p_digits,1,2) || '-' || substr(p_digits,3,4) || '-' || substr(p_digits,7,4)
    WHEN length(p_digits) = 10 THEN substr(p_digits,1,3) || '-' || substr(p_digits,4,3) || '-' || substr(p_digits,7,4)
    ELSE p_digits
  END
$$;

CREATE OR REPLACE FUNCTION public.cms_register_managed_person(
  p_name text,
  p_phone text,
  p_email text,
  p_birth_date date,
  p_reason text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text := btrim(COALESCE(p_name, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_email  text := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_digits text := private_managed_phone_digits(p_phone);
  v_existing uuid;
  v_code   text;
  v_id     uuid;
BEGIN
  IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'name_required'); END IF;
  IF length(v_name) > 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'name_too_long'); END IF;
  IF v_digits !~ '^0[0-9]{8,10}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'phone_invalid'); END IF;
  IF v_reason = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'reason_required'); END IF;
  IF length(v_reason) > 1000 THEN RETURN jsonb_build_object('ok', false, 'error', 'reason_too_long'); END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 255 OR v_email !~ '^[^@\s]+@[^@\s]+$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_invalid');
  END IF;

  SELECT id INTO v_existing FROM managed_persons WHERE phone_digits = v_digits AND deleted_at IS NULL;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_phone', 'existing_id', v_existing);
  END IF;

  v_code := generate_member_code('B2C', true, 'MG');

  BEGIN
    INSERT INTO managed_persons (name, phone, phone_digits, email, birth_date, reason, member_code, created_by)
    VALUES (v_name, private_managed_phone_display(v_digits), v_digits, v_email, p_birth_date, v_reason, v_code, p_created_by)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- 동시에 같은 번호가 등록된 경우(사전 중복 확인과 INSERT 사이) — 내부 오류 문구 대신 중복 코드로 정리
    SELECT id INTO v_existing FROM managed_persons WHERE phone_digits = v_digits AND deleted_at IS NULL;
    IF v_existing IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'register_failed'); END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_phone', 'existing_id', v_existing);
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'member_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_update_managed_person(
  p_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_birth_date date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text := btrim(COALESCE(p_name, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_email  text := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_digits text := private_managed_phone_digits(p_phone);
  v_dup    uuid;
BEGIN
  IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'name_required'); END IF;
  IF length(v_name) > 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'name_too_long'); END IF;
  IF v_digits !~ '^0[0-9]{8,10}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'phone_invalid'); END IF;
  IF v_reason = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'reason_required'); END IF;
  IF length(v_reason) > 1000 THEN RETURN jsonb_build_object('ok', false, 'error', 'reason_too_long'); END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 255 OR v_email !~ '^[^@\s]+@[^@\s]+$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_invalid');
  END IF;

  SELECT id INTO v_dup FROM managed_persons WHERE phone_digits = v_digits AND deleted_at IS NULL AND id <> p_id;
  IF v_dup IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_phone', 'existing_id', v_dup);
  END IF;

  BEGIN
    UPDATE managed_persons
       SET name = v_name, phone = private_managed_phone_display(v_digits), phone_digits = v_digits,
           email = v_email, birth_date = p_birth_date, reason = v_reason, updated_at = now()
     WHERE id = p_id AND deleted_at IS NULL;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_dup FROM managed_persons WHERE phone_digits = v_digits AND deleted_at IS NULL AND id <> p_id;
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_phone', 'existing_id', v_dup);
  END;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_delete_managed_person(p_id uuid, p_deleted_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE managed_persons
     SET deleted_at = now(), deleted_by = p_deleted_by, updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cms_register_managed_person(text,text,text,date,text,uuid)',
    'public.cms_update_managed_person(uuid,text,text,text,date,text)',
    'public.cms_delete_managed_person(uuid,uuid)',
    'public.private_managed_phone_digits(text)',
    'public.private_managed_phone_display(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. get_customer_list — 비회원 관리대상 갈래 UNION (베이스: #526 정의 + is_managed_person)
--    · 비회원 행은 blacklisted=true 고정 → '관리대상' 칩에 노출, '정상' 칩에서 제외
--    · 분류 칩(학생/구독/일반)이 선택되면 비회원은 제외(분류 개념 없음)
--    · 검색: 이름·이메일·전화(ILIKE) + 비회원은 숫자만 정규화한 전화번호도 매칭
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
  foreign_approved_at timestamp with time zone,
  is_managed_person boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offset INT := (p_page - 1) * p_limit;
  v_digits TEXT := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
BEGIN
  RETURN QUERY
  WITH combined AS (
    SELECT
      up.id                       AS c_user_id,
      up.email::TEXT              AS c_email,
      up.phone::TEXT              AS c_phone,
      up.full_name::TEXT          AS c_name,
      up.member_code::TEXT        AS c_member_code,
      up.member_type::TEXT        AS c_member_type,
      up.membership_grade::TEXT   AS c_membership_grade,
      up.credit_score             AS c_credit_score,
      up.rental_count             AS c_rental_count,
      up.late_return_count        AS c_late_return_count,
      up.damage_count             AS c_damage_count,
      up.points                   AS c_points,
      up.blacklisted              AS c_blacklisted,
      up.blacklist_reason::TEXT   AS c_blacklist_reason,
      up.is_student               AS c_is_student,
      up.is_foreign               AS c_is_foreign,
      up.identity_type            AS c_identity_type,
      up.identity_doc_url         AS c_identity_doc_url,
      up.identity_verified_at     AS c_identity_verified_at,
      up.foreign_doc_url::TEXT    AS c_foreign_doc_url,
      up.foreign_doc_urls         AS c_foreign_doc_urls,
      up.foreign_type             AS c_foreign_type,
      up.foreign_stay_type::TEXT  AS c_foreign_stay_type,
      up.foreign_verified_at      AS c_foreign_verified_at,
      up.password_set             AS c_password_set,
      up.created_at               AS c_created_at,
      up.cms_role::TEXT           AS c_cms_role,
      up.birth_date               AS c_birth_date,
      up.withdrawal_status::TEXT  AS c_withdrawal_status,
      up.withdrawal_requested_at  AS c_withdrawal_requested_at,
      up.withdrawal_purge_at      AS c_withdrawal_purge_at,
      up.legacy_imported_at       AS c_legacy_imported_at,
      up.legacy_claimed_at        AS c_legacy_claimed_at,
      up.legacy_source::TEXT      AS c_legacy_source,
      up.legacy_signup_at         AS c_legacy_signup_at,
      up.legacy_purchase_count    AS c_legacy_purchase_count,
      up.identity_approved_at     AS c_identity_approved_at,
      up.foreign_approved_at      AS c_foreign_approved_at,
      false                       AS c_is_managed_person,
      NULL::TEXT                  AS c_phone_digits
    FROM user_profiles up
    WHERE up.deleted_at IS NULL
    UNION ALL
    SELECT
      mp.id,
      COALESCE(mp.email, '')::TEXT,
      mp.phone::TEXT,
      mp.name::TEXT,
      mp.member_code::TEXT,
      NULL::TEXT,
      'NONE'::TEXT,
      70::smallint,
      0, 0, 0, 0,
      true,
      mp.reason::TEXT,
      false, false,
      NULL::TEXT[], NULL::TEXT[], NULL::timestamptz,
      NULL::TEXT, NULL::TEXT[], NULL::TEXT[], NULL::TEXT,
      NULL::timestamptz,
      false,
      mp.created_at,
      NULL::TEXT,
      mp.birth_date,
      'none'::TEXT, NULL::timestamptz, NULL::timestamptz,
      NULL::timestamptz, NULL::timestamptz, NULL::TEXT, NULL::timestamptz, NULL::integer,
      NULL::timestamptz, NULL::timestamptz,
      true,
      mp.phone_digits::TEXT
    FROM managed_persons mp
    WHERE mp.deleted_at IS NULL
  )
  SELECT
    c.c_user_id, c.c_email, c.c_phone, c.c_name, c.c_member_code, c.c_member_type,
    c.c_membership_grade, c.c_credit_score, c.c_rental_count, c.c_late_return_count,
    c.c_damage_count, c.c_points, c.c_blacklisted, c.c_blacklist_reason,
    c.c_is_student, c.c_is_foreign,
    c.c_identity_type, c.c_identity_doc_url, c.c_identity_verified_at,
    c.c_foreign_doc_url, c.c_foreign_doc_urls, c.c_foreign_type, c.c_foreign_stay_type,
    c.c_foreign_verified_at,
    c.c_password_set, c.c_created_at,
    COUNT(*) OVER()             AS total_count,
    c.c_cms_role, c.c_birth_date,
    c.c_withdrawal_status, c.c_withdrawal_requested_at, c.c_withdrawal_purge_at,
    c.c_legacy_imported_at, c.c_legacy_claimed_at, c.c_legacy_source,
    c.c_legacy_signup_at, c.c_legacy_purchase_count,
    c.c_identity_approved_at, c.c_foreign_approved_at,
    c.c_is_managed_person
  FROM combined c
  WHERE (p_user_id IS NULL OR c.c_user_id = p_user_id)
    AND (
      p_user_id IS NOT NULL OR p_search IS NULL OR p_search = '' OR (
        c.c_name  ILIKE '%' || p_search || '%'
        OR c.c_email ILIKE '%' || p_search || '%'
        OR c.c_phone ILIKE '%' || p_search || '%'
        OR (c.c_is_managed_person AND v_digits <> '' AND c.c_phone_digits LIKE '%' || v_digits || '%')
      )
    )
    AND (
      p_user_id IS NOT NULL OR p_membership_grade IS NULL OR p_membership_grade = ''
      OR c.c_membership_grade = p_membership_grade
    )
    AND (p_user_id IS NOT NULL OR p_blacklisted IS NULL OR c.c_blacklisted = p_blacklisted)
    AND (
      p_user_id IS NOT NULL OR p_classifications IS NULL
      OR array_length(p_classifications, 1) IS NULL
      OR (
        NOT c.c_is_managed_person AND (
          ('student'    = ANY(p_classifications) AND c.c_is_student = true)
          OR ('subscriber' = ANY(p_classifications) AND c.c_membership_grade IS DISTINCT FROM 'NONE')
          OR ('general'    = ANY(p_classifications) AND c.c_is_student = false
              AND c.c_membership_grade IS NOT DISTINCT FROM 'NONE')
        )
      )
    )
  ORDER BY c.c_created_at DESC
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
   (migration #364 정책, 매 DROP+CREATE 후 REVOKE 재적용 필수). migration #686에서 managed_persons(관리대상 비회원) UNION + is_managed_person 컬럼 추가.';
