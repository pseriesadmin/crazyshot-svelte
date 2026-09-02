-- Migration 418: user_profiles.phone 중복 가입 차단
-- 목적:
--   ① UNIQUE 부분 인덱스 — 동일 휴대폰 번호로 복수 계정 생성 구조적 차단
--   ② verify_and_update_phone RPC — 중복 번호 명시적 에러 반환
--      (인덱스만으로는 DB 레벨 exception이 프론트에 애매하게 전달되므로 RPC에서 선제 차단)
--
-- 인덱스 설계:
--   - NULL 제외 (purged 계정의 phone=NULL 허용, 탈퇴 계정 재가입 경로 유지)
--   - withdrawal_status='purged' 계정의 phone은 이미 NULL로 마스킹되므로 충돌 없음
--   - withdrawal_status='requested'(탈퇴 유예 중) 계정은 service-operations.md §16 §10에 따라
--     withdrawal_conflict 에러로 별도 차단 (기존 로직 유지)
--
-- RPC 확장 위치: ③ withdrawal_conflict 체크 직후, ④ OTP 소모 전 — 중복 시 OTP 미소모
-- 의존: Migration #370(verify_and_update_phone 최신본), Migration #365(withdrawal_status)
-- 영향 범위: 회원가입·마이페이지 휴대폰 변경 두 경로 모두 이 RPC 경유

-- ══════════════════════════════════════════════════════════════════
-- STEP 1: UNIQUE 부분 인덱스 (NULL 제외)
-- ══════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_profiles_phone
  ON user_profiles (phone)
  WHERE phone IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- STEP 2: verify_and_update_phone RPC — 중복 체크 추가
-- ══════════════════════════════════════════════════════════════════
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
  v_uid            UUID := auth.uid();
  v_otp            phone_otps%ROWTYPE;
  v_conflict_count INT;
  v_dup_count      INT;
BEGIN
  -- ① 인증 체크
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  -- ② OTP 검증 — 만료 안 됐고 미사용인 가장 최신 OTP 조회
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

  -- ③ 탈퇴 유예기간 중인 다른 계정 휴대폰 충돌 체크 (기존 로직 유지 — OTP 미소모)
  SELECT COUNT(*) INTO v_conflict_count
  FROM user_profiles
  WHERE phone             = p_phone
    AND user_id           != v_uid
    AND withdrawal_status = 'requested';

  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '이미 탈퇴 유예기간 중인 계정이 있습니다. 기존 계정으로 로그인해 주세요.',
      'error_code', 'withdrawal_conflict'
    );
  END IF;

  -- ③-B 중복 가입 체크 — 다른 활성 계정이 동일 번호를 이미 사용 중인 경우 (OTP 미소모)
  SELECT COUNT(*) INTO v_dup_count
  FROM user_profiles
  WHERE phone    = p_phone
    AND user_id != v_uid;

  IF v_dup_count > 0 THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '이미 가입된 휴대폰 번호입니다.',
      'error_code', 'phone_duplicate'
    );
  END IF;

  -- ④ OTP 사용 처리 (verified_at 마킹 — 모든 conflict 통과 후에만 소모)
  UPDATE phone_otps SET verified_at = now() WHERE id = v_otp.id;

  -- ⑤ 휴대폰 번호 업데이트
  UPDATE user_profiles
  SET phone      = p_phone,
      updated_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- GRANT 재확인 — 기존과 동일 권한 유지
GRANT EXECUTE ON FUNCTION verify_and_update_phone(TEXT, TEXT) TO authenticated;
