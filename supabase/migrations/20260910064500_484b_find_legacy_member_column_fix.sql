-- Migration 484b: find_legacy_member 컬럼명 + 대소문자 매칭 버그 수정
--
-- 배경: Migration 484가 생성한 find_legacy_member RPC가 user_profiles의 실제 컬럼명
-- full_name 대신 존재하지 않는 name 컬럼을 참조하고 있었다(WHERE절 up.name, RETURN절
-- v_up.name 두 곳 모두) — information_schema.columns 직접 조회로 user_profiles에는
-- full_name만 존재함을 확인 후 수정.
--
-- 동시에 승인된 플랜(§Step2 "느슨한 매칭" 요구사항 — CSV 원본 영문 이름이 대문자로 저장된
-- 행이 있어 정확 매칭만으로는 실패)에 명시된 대소문자 무시 + 공백 제거 매칭도 이 시점에
-- 함께 반영한다.
--
-- ⚠️ 이 파일은 세션 사후 백필 기록이다(2026-09-10) — 원래 apply_migration으로
-- "484b_find_legacy_member_column_fix"라는 이름으로 Stage에 직접 적용됐으나, 그 시점에는
-- 이 내용을 별도 로컬 마이그레이션 파일로 남기지 않고 484 원본 파일을 직접 편집(in-place)
-- 했었다(core-rules.md GP-10 "기존 마이그레이션 파일 직접 수정 금지" 위반). Stage 실제
-- 마이그레이션 이력과 로컬 저장소를 일치시키기 위해 이 파일로 분리·백필했다.

CREATE OR REPLACE FUNCTION find_legacy_member(
  p_name  TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_up  user_profiles%ROWTYPE;
  v_enc TEXT;
BEGIN
  -- 이름 + 전화번호로 레거시 계정 조회
  -- 이름은 대소문자 무시 + 공백 제거 후 비교(플랜 §Step2 "느슨한 매칭" — 영문 이름
  -- CSV 원본이 대문자로 저장된 행이 있어 정확 매칭만으로는 실패할 수 있음)
  SELECT up.*
  INTO   v_up
  FROM   public.user_profiles up
  WHERE  UPPER(TRIM(up.full_name)) = UPPER(TRIM(p_name))
    AND  up.phone                  = p_phone
    AND  up.legacy_imported_at     IS NOT NULL
    AND  up.deleted_at             IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- auth.users.encrypted_password 조회 — 이미 클레임 완료된 계정 제외
  SELECT au.encrypted_password
  INTO   v_enc
  FROM   auth.users au
  WHERE  au.id = v_up.user_id;

  -- 이미 비밀번호가 설정된 계정은 매칭 실패로 취급 (EC-2)
  IF v_enc IS NOT NULL AND v_enc <> '' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'user_id',               v_up.user_id::text,
    'email',                 v_up.email,
    'name',                  v_up.full_name,
    'phone',                 v_up.phone,
    'membership_grade',      v_up.membership_grade::text,
    'legacy_signup_at',      v_up.legacy_signup_at,
    'legacy_purchase_count', v_up.legacy_purchase_count,
    'points',                v_up.points
  );
END;
$$;

-- service_role 전용: 클라이언트(anon/authenticated) 직접 호출 차단
REVOKE ALL ON FUNCTION find_legacy_member(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) TO service_role;
