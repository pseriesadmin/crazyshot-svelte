-- Migration #137: 본인증명·외국인증명 문서 URL 컬럼 추가
-- user_profiles에 identity_doc_url, identity_verified_at, foreign_doc_url, foreign_verified_at 추가
-- identity_type CHECK 제약 확장 (resident, driver, other 추가)
-- Supabase Storage user-documents 버킷 생성
-- update_user_doc_url RPC 생성 (사용자가 자신의 문서 URL 저장)
-- 2026-07-22

-- 1. identity_type CHECK 제약 확장
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_identity_type_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_identity_type_check
  CHECK (identity_type IN ('general', 'student', 'resident', 'driver', 'other'));

COMMENT ON COLUMN user_profiles.identity_type IS
  '본인 증명 종류: general(일반) | student(학생증) | resident(주민등록증) | driver(운전면허증) | other(기타) | NULL(미등록)';

-- 2. 신규 컬럼 추가 (기존 student_doc_url / student_verified_at 유지)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS identity_doc_url     TEXT,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS foreign_doc_url      TEXT,
  ADD COLUMN IF NOT EXISTS foreign_verified_at  TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.identity_doc_url     IS '본인증명 파일 공개 URL (Supabase Storage user-documents)';
COMMENT ON COLUMN user_profiles.identity_verified_at IS '본인증명 등록일시';
COMMENT ON COLUMN user_profiles.foreign_doc_url      IS '외국인증명 파일 공개 URL (여권·외국인등록증)';
COMMENT ON COLUMN user_profiles.foreign_verified_at  IS '외국인증명 등록일시';

-- 3. Supabase Storage 버킷 생성 (public — 서비스 롤만 업로드, URL로 뷰)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-documents',
  'user-documents',
  true,
  10485760,
  ARRAY['image/png','image/jpeg','image/webp','image/heif','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 4. update_user_doc_url RPC — 인증된 사용자가 자신의 문서 URL 저장
DROP FUNCTION IF EXISTS update_user_doc_url(TEXT, TEXT, TEXT);

CREATE FUNCTION update_user_doc_url(
  p_type          TEXT,
  p_doc_url       TEXT,
  p_identity_type TEXT DEFAULT NULL
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
       p_identity_type NOT IN ('general', 'student', 'resident', 'driver', 'other') THEN
      RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 증명 종류');
    END IF;

    UPDATE user_profiles
    SET
      identity_doc_url     = p_doc_url,
      identity_verified_at = NOW(),
      identity_type        = COALESCE(p_identity_type, identity_type, 'general'),
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

GRANT EXECUTE ON FUNCTION update_user_doc_url(TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT, TEXT) IS
  '인증된 사용자가 자신의 본인증명(identity) 또는 외국인증명(foreign) 문서 URL을 저장. foreign 저장 시 is_foreign=true 자동 설정.';
