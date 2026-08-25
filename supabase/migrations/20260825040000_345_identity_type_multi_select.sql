-- Migration #345: user_profiles.identity_type 다중 선택 지원 (배열 컬럼 전환) + '주민등록등본' 추가
-- 배경: 내정보 > 개인정보 > 본인 증명 섹션의 증명 유형 콤보버튼을 단일선택 → 다중선택으로
-- 전환하는 UI 요청(Stephen 확정: "전부 저장, 배열 컬럼으로 DB 확장"). 신규 유형
-- '주민등록등본'(resident_copy)도 함께 추가.

-- 1. 기존 CHECK 제약 제거 (컬럼 타입 변경 전 필수 — 스칼라 기준 제약이라 배열엔 안 맞음)
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_identity_type_check;

-- 2. TEXT → TEXT[] 전환 (기존 단일값은 1개짜리 배열로 보존, NULL은 그대로 NULL)
ALTER TABLE user_profiles
  ALTER COLUMN identity_type TYPE TEXT[]
  USING (CASE WHEN identity_type IS NULL THEN NULL ELSE ARRAY[identity_type] END);

-- 3. 신규 CHECK 제약 — 배열의 모든 원소가 허용 목록 안에 있어야 함 + 'resident_copy' 추가
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_identity_type_check
  CHECK (
    identity_type IS NULL
    OR identity_type <@ ARRAY['general', 'student', 'resident', 'resident_copy', 'driver', 'other']::text[]
  );

COMMENT ON COLUMN user_profiles.identity_type IS
  '본인 증명 종류(다중 선택 가능): general(일반) | student(학생증) | resident(주민등록증) |
   resident_copy(주민등록등본) | driver(운전면허증) | other(기타) | NULL(미등록)';

-- 4. update_user_doc_url RPC 재발행 — p_identity_type: TEXT → TEXT[]
--    (인자 타입이 바뀌므로 기존 3-param TEXT 버전을 명시적으로 DROP — 안 하면 오버로드가
--    공존해 PostgREST 호출 모호성(PGRST203) 위험, products.md §2-3에 문서화된 동일 패턴 함정)
DROP FUNCTION IF EXISTS update_user_doc_url(TEXT, TEXT, TEXT);

CREATE FUNCTION update_user_doc_url(
  p_type          TEXT,
  p_doc_url       TEXT,
  p_identity_type TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_type NOT IN ('identity', 'foreign') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 문서 유형');
  END IF;

  IF p_type = 'identity' THEN
    IF p_identity_type IS NOT NULL AND
       NOT (p_identity_type <@ ARRAY['general', 'student', 'resident', 'resident_copy', 'driver', 'other']::text[]) THEN
      RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 증명 종류');
    END IF;

    UPDATE user_profiles
    SET
      identity_doc_url     = p_doc_url,
      identity_verified_at = NOW(),
      identity_type        = COALESCE(p_identity_type, identity_type, ARRAY['general']::text[]),
      updated_at           = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;

  ELSIF p_type = 'foreign' THEN
    UPDATE user_profiles
    SET
      foreign_doc_url     = p_doc_url,
      foreign_verified_at = NOW(),
      is_foreign          = true,
      updated_at          = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사용자를 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_doc_url(TEXT, TEXT, TEXT[]) TO authenticated;

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT, TEXT[]) IS
  '인증된 사용자가 자신의 본인증명(identity, 다중 유형 배열) 또는 외국인증명(foreign) 문서 URL을 저장.';
