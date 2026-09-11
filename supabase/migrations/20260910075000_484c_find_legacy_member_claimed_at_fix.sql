-- Migration 484c: find_legacy_member "이미 클레임됨" 판정기준을 legacy_claimed_at으로 교체
--
-- 배경: Migration 484/484b의 find_legacy_member RPC는 "이미 클레임된 계정"을
-- auth.users.encrypted_password IS NULL/''로 판정하도록 설계됐으나, TDD 라이브 통합테스트로
-- Stage에서 직접 검증한 결과 admin.auth.admin.createUser({email, email_confirm:true})는
-- password를 지정하지 않아도 GoTrue가 즉시 실제 bcrypt 해시를 채워넣는다는 사실을 확인했다
-- (SQL 직접 조회 — 60자리 해시, NULL/빈문자열 아님). 즉 방금 선등록된 미인증 레거시 계정도
-- 전부 "이미 클레임됨"으로 오판되어 클레임 흐름이 단 한 건도 성공할 수 없는 결함이었다.
--
-- 이 파일은 Migration 485(user_profiles.legacy_claimed_at 컬럼 신설)에 의존한다 — 반드시
-- 그 이후에 적용돼야 한다.
--
-- ⚠️ 이 파일은 세션 사후 백필 기록이다(2026-09-10) — 원래 apply_migration으로
-- "484c_find_legacy_member_claimed_at_fix"라는 이름으로 Stage에 직접 적용됐으나, 그
-- 시점에는 이 내용을 별도 로컬 마이그레이션 파일로 남기지 않고 484 원본 파일을 다시
-- 직접 편집(in-place)했었다(core-rules.md GP-10 위반). Stage 실제 마이그레이션 이력과
-- 로컬 저장소를 일치시키기 위해 이 파일로 분리·백필했다.

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
BEGIN
  -- 이름 + 전화번호로 레거시 계정 조회
  -- 이름은 대소문자 무시 + 공백 제거 후 비교(플랜 §Step2 "느슨한 매칭" — 영문 이름
  -- CSV 원본이 대문자로 저장된 행이 있어 정확 매칭만으로는 실패할 수 있음)
  -- 클레임 여부는 legacy_claimed_at으로만 판정한다 — auth.users.encrypted_password는
  -- 비밀번호 미지정 생성 시에도 GoTrue가 임의 해시를 채워넣어 신뢰할 수 없다(Migration 485).
  SELECT up.*
  INTO   v_up
  FROM   public.user_profiles up
  WHERE  UPPER(TRIM(up.full_name)) = UPPER(TRIM(p_name))
    AND  up.phone                  = p_phone
    AND  up.legacy_imported_at     IS NOT NULL
    AND  up.legacy_claimed_at      IS NULL
    AND  up.deleted_at             IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
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
