-- Migration 490: find_legacy_member을 legacy_member_staging 대상으로 재정의
--
-- Migration 483/484/484b/485/484c가 만든 user_profiles 기반 구버전(CSV 임포트 즉시 실
-- 고객 DB에 편입시키던 설계)을 대체한다 — 시그니처(TEXT, TEXT)는 동일하므로 DROP FUNCTION
-- 없이 CREATE OR REPLACE로 충분하다(484b/484c도 동일 패턴으로 재정의했음).
--
-- 반환 필드에서 user_id/membership_grade/points가 빠진다 — 이 시점엔 아직 auth.users/
-- user_profiles 계정이 존재하지 않기 때문(계정은 complete 엔드포인트에서 클레임 성공 시에만
-- 생성됨, Migration 489 배경 참고). 대신 staging_id(클레임 완료 후 삭제 대상 식별용)와
-- legacy_imported_at(원본 등록시각 — 신규 계정 생성 시 감사 이력으로 그대로 이관)을 반환한다.

CREATE OR REPLACE FUNCTION find_legacy_member(
  p_name  TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row legacy_member_staging%ROWTYPE;
BEGIN
  -- 이름은 대소문자 무시 + 공백 제거 후 비교(Migration 484b의 "느슨한 매칭" 정책 유지 —
  -- 영문 이름 CSV 원본이 대문자로 저장된 행이 있어 정확 매칭만으로는 실패할 수 있음)
  SELECT *
  INTO   v_row
  FROM   public.legacy_member_staging
  WHERE  UPPER(TRIM(full_name)) = UPPER(TRIM(p_name))
    AND  phone                  = p_phone
    AND  claimed_at             IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'staging_id',             v_row.id::text,
    'email',                  v_row.email,
    'name',                   v_row.full_name,
    'phone',                  v_row.phone,
    'legacy_source',          v_row.legacy_source,
    'legacy_signup_at',       v_row.legacy_signup_at,
    'legacy_purchase_count',  v_row.legacy_purchase_count,
    'legacy_imported_at',     v_row.imported_at
  );
END;
$$;

-- service_role 전용: 클라이언트(anon/authenticated) 직접 호출 차단
REVOKE ALL ON FUNCTION find_legacy_member(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) TO service_role;
