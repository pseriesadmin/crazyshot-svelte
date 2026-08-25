-- Migration #349: delete_user_doc RPC 신설 — 본인증명/외국인증명 완전 삭제(재등록과 별개)
-- 배경: update_user_doc_url(#346)은 새 파일이 반드시 있어야만 동작(빈 배열 거부) — 재등록 없이
-- "등록된 문서를 그냥 삭제만" 하는 경로가 없었다. 화면에 삭제 아이콘을 추가하면서 DB 컬럼을
-- NULL로 되돌리는 전용 RPC가 필요해 신설. 실제 Storage 파일 삭제는 앱 서버(/api/profile/
-- delete-doc)가 이 RPC 성공 이후 별도로 처리한다(upload-doc의 옛 파일 정리 로직과 동일 패턴).

CREATE FUNCTION delete_user_doc(
  p_type TEXT
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
    UPDATE user_profiles
    SET
      identity_doc_url     = NULL,
      identity_type        = NULL,
      identity_verified_at = NULL,
      updated_at           = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;

  ELSIF p_type = 'foreign' THEN
    UPDATE user_profiles
    SET
      foreign_doc_url     = NULL,
      foreign_verified_at = NULL,
      is_foreign          = false,
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

GRANT EXECUTE ON FUNCTION delete_user_doc(TEXT) TO authenticated;

COMMENT ON FUNCTION delete_user_doc(TEXT) IS
  '인증된 사용자가 자신의 본인증명(identity) 또는 외국인증명(foreign) 등록 정보를 완전히
   삭제(NULL 초기화)한다. update_user_doc_url(#346)과 달리 새 파일 업로드 없이 순수 삭제만
   수행 — 실제 Storage 파일 삭제는 호출부(앱 서버)가 이 RPC 성공 이후 처리한다.';
