-- Migration 132: user_profiles.birth_date 컬럼 + phone_otps 테이블 + RPC 2종
-- 목적: 회원 개인정보 수정(이름·이메일·생년월일) + 휴대폰 SMS OTP 인증 기능

-- 1. user_profiles.birth_date 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE;

-- 2. phone_otps 테이블 (사용자 휴대폰 인증용 OTP 저장)
CREATE TABLE IF NOT EXISTS phone_otps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_phone_otps" ON phone_otps;
CREATE POLICY "service_role_only_phone_otps" ON phone_otps
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_phone_otps_user_phone
  ON phone_otps(user_id, phone, expires_at);

-- 3. RPC: update_user_profile — 이름·이메일·생년월일 수정 (사용자 본인)
CREATE OR REPLACE FUNCTION update_user_profile(
  p_full_name  TEXT    DEFAULT NULL,
  p_email      TEXT    DEFAULT NULL,
  p_birth_date DATE    DEFAULT NULL
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
    full_name  = COALESCE(p_full_name,  full_name),
    email      = COALESCE(p_email,      email),
    birth_date = COALESCE(p_birth_date, birth_date),
    updated_at = now()
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_profile(TEXT, TEXT, DATE) TO authenticated;

-- 4. RPC: verify_and_update_phone — OTP 검증 후 phone 컬럼 업데이트
CREATE OR REPLACE FUNCTION verify_and_update_phone(
  p_phone TEXT,
  p_code  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_otp phone_otps%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  SELECT * INTO v_otp
  FROM phone_otps
  WHERE user_id     = v_uid
    AND phone       = p_phone
    AND code        = p_code
    AND expires_at  > now()
    AND verified_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '인증번호가 올바르지 않거나 만료되었습니다.');
  END IF;

  UPDATE phone_otps SET verified_at = now() WHERE id = v_otp.id;

  UPDATE user_profiles
  SET phone      = p_phone,
      updated_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_and_update_phone(TEXT, TEXT) TO authenticated;
