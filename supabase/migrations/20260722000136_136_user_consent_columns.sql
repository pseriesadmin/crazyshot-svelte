-- Migration 136: user_profiles 개인정보 동의 컬럼 2종 추가 + RPC 업데이트
-- 목적: 개인정보 수집·이용 동의 / 제3자 제공 동의 상태 저장

-- 1. user_profiles 동의 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS allow_privacy_consent       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_third_party_consent   BOOLEAN NOT NULL DEFAULT false;

-- 2. RPC: update_user_consent — 동의 항목 단독 업데이트 (사용자 본인)
CREATE OR REPLACE FUNCTION update_user_consent(
  p_allow_privacy_consent     BOOLEAN DEFAULT NULL,
  p_allow_third_party_consent BOOLEAN DEFAULT NULL
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
    allow_privacy_consent     = COALESCE(p_allow_privacy_consent,     allow_privacy_consent),
    allow_third_party_consent = COALESCE(p_allow_third_party_consent, allow_third_party_consent),
    updated_at = now()
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_consent(BOOLEAN, BOOLEAN) TO authenticated;
