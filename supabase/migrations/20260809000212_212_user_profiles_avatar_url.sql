-- Migration #212: user_profiles.avatar_url 컬럼 추가 + update_user_avatar RPC
-- 목적: 내정보 > 개인정보 탭 아바타 이미지 업로드 기능 신규 구축(기존 DB 컬럼 없음, 신규)

-- 1. avatar_url 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN user_profiles.avatar_url IS
  '프로필 사진(아바타) 공개 URL (Supabase Storage user-documents 버킷, avatar/ 경로)';

-- 2. RPC: update_user_avatar — 아바타 URL 저장 (사용자 본인)
DROP FUNCTION IF EXISTS update_user_avatar(TEXT);

CREATE FUNCTION update_user_avatar(
  p_avatar_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  UPDATE user_profiles
  SET
    avatar_url = p_avatar_url,
    updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_avatar(TEXT) TO authenticated;

COMMENT ON FUNCTION update_user_avatar(TEXT) IS
  '인증된 사용자가 자신의 프로필 사진(아바타) URL을 저장.';
