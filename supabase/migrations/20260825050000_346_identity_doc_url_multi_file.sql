-- Migration #346: user_profiles.identity_doc_url 다중 파일 지원 (배열 컬럼 전환, 최대 5개)
-- 배경: 본인 증명 업로드를 드래그앤드롭 다중 선택(최대 5개 동시)으로 확장하는 UI 요청.
-- Migration #345에서 identity_type(증명 유형)은 이미 배열로 전환했고, 이번엔 실제 업로드
-- 파일 URL(identity_doc_url)도 배열로 확장한다. foreign_doc_url(외국인 증명)은 이번 요청
-- 범위 밖 — 여전히 파일 1개만 허용하는 TEXT 컬럼으로 무변경 유지.

-- 1. TEXT → TEXT[] 전환 (기존 단일 URL은 1개짜리 배열로 보존)
ALTER TABLE user_profiles
  ALTER COLUMN identity_doc_url TYPE TEXT[]
  USING (CASE WHEN identity_doc_url IS NULL THEN NULL ELSE ARRAY[identity_doc_url] END);

-- 2. 최대 5개 제약 (프론트 제한과 별개로 서버측 방어)
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_identity_doc_url_max5
  CHECK (identity_doc_url IS NULL OR array_length(identity_doc_url, 1) <= 5);

COMMENT ON COLUMN user_profiles.identity_doc_url IS
  '본인 증명 파일 공개 URL 배열(최대 5개, Supabase Storage user-documents). 외국인증명
   (foreign_doc_url)과 달리 다중 업로드 지원.';

-- 3. update_user_doc_url RPC 재발행 — p_doc_url: TEXT → TEXT[]
--    (인자 타입 변경이라 기존 3-param TEXT[] 버전을 명시적으로 DROP — Migration #345와 동일
--    이유로 오버로드 공존 시 PostgREST 호출 모호성(PGRST203) 위험)
--    identity: p_doc_url을 그대로 배열 할당(교체, 누적 아님 — 매 등록/재등록마다 새 세트로
--    덮어씀). foreign: 여전히 파일 1개만 다루므로 배열의 첫 원소만 꺼내 기존 TEXT 컬럼에 저장
--    (foreign_doc_url 컬럼 자체는 무변경 — 호출부가 1개짜리 배열로 감싸서 넘기도록 조정).
DROP FUNCTION IF EXISTS update_user_doc_url(TEXT, TEXT, TEXT[]);

CREATE FUNCTION update_user_doc_url(
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

GRANT EXECUTE ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[]) TO authenticated;

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[]) IS
  '인증된 사용자가 자신의 본인증명(identity, 최대 5개 파일 배열) 또는 외국인증명(foreign,
   1개 파일 — 배열로 감싸 전달, 첫 원소만 사용) 문서 URL을 저장.';
