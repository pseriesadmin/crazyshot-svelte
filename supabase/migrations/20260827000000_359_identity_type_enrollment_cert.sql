-- Migration #359: identity_type에 '재학증명서'(enrollment) 값 추가
-- 배경: 본인증명 콤보 버튼에 '재학증명서'(학생증과 짝을 이루는 필수 세트) 신규 추가.
-- update_user_doc_url(#346) 내부의 valid identity_type 화이트리스트를 확장한다 —
-- 컬럼 자체(identity_type TEXT[])나 함수 시그니처는 변경 없음, 허용값 배열만 확장.

CREATE OR REPLACE FUNCTION update_user_doc_url(
  p_type          TEXT,
  p_doc_url       TEXT[],
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

  IF p_doc_url IS NULL OR array_length(p_doc_url, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '파일이 없습니다.');
  END IF;

  IF p_type = 'identity' THEN
    IF array_length(p_doc_url, 1) > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', '최대 5개까지 등록할 수 있어요.');
    END IF;

    IF p_identity_type IS NOT NULL AND
       NOT (p_identity_type <@ ARRAY['general', 'student', 'enrollment', 'resident', 'resident_copy', 'driver', 'other']::text[]) THEN
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
      foreign_doc_url     = p_doc_url[1],
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

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[]) IS
  '인증된 사용자가 자신의 본인증명(identity, 최대 5개 파일 배열 — student/enrollment/resident/
   resident_copy/driver/other/general) 또는 외국인증명(foreign, 1개 파일 — 배열로 감싸 전달,
   첫 원소만 사용) 문서 URL을 저장.';
