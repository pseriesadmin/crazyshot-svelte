-- Migration 370: verify_and_update_phone — 탈퇴유예중 계정 휴대폰 충돌 차단 로직 추가
-- 목적: Q8 정책 반영 — 탈퇴 유예기간 중인 다른 계정과 동일 휴대폰번호로 인증 시도 시
--       병합 없이 안내 후 차단 (withdrawal_conflict error_code 반환)
--
-- ⛔ 기존 파라미터 시그니처(TEXT, TEXT)와 기존 반환 키(ok, error)는 절대 변경하지 않음
--    — 기존 프론트 호출부(account/profile/+page.server.ts 등)가 그대로 동작해야 함.
--    신규 분기는 {ok:false, error:'...', error_code:'withdrawal_conflict'} 형태로만 추가.
--
-- 확장 로직 위치: OTP 검증 성공 후 → phone UPDATE 실행 전 (OTP는 conflict 시 소모하지 않음)
--
-- 의존: Migration #365(withdrawal_status 컬럼), Migration #132(verify_and_update_phone 원본)
-- plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-④
-- TDD: src/__tests__/services/accountWithdrawalPhone.test.ts (케이스 3개)

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

  -- ③ Q8 정책: 탈퇴 유예기간 중인 다른 계정 휴대폰 충돌 체크
  --    OTP 검증 통과 후 / phone UPDATE 전에 실행 — conflict 시 OTP를 소모하지 않음
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

  -- ④ OTP 사용 처리 (verified_at 마킹 — conflict 없을 때만 소모)
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
