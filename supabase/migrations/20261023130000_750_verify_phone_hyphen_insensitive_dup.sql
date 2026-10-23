-- Migration 750 — verify_and_update_phone: 중복·탈회 유예 번호 비교를 하이픈 무시로 (2026-10-23)
--
-- 배경: 프로필의 휴대폰 번호는 "01012345678"과 "010-1234-5678" 두 형식이 섞여 저장돼 있다. 기존 검사는 입력값(숫자만)과 문자열이 정확히 같은 행만 찾아
--       하이픈 형식으로 저장된 다른 계정의 번호를 놓쳤다(고유 인덱스도 문자열 기준이라 같은 한계).
-- 수정: 탈회 유예(withdrawal_conflict)·중복(phone_duplicate) 두 검사만 숫자 외 문자를 무시하고 비교한다.
--       그 외 본문(OTP 조회·소비·저장 형식)·시그니처·권한(authenticated·service_role, anon 불가)은 #370/#377 그대로.

CREATE OR REPLACE FUNCTION public.verify_and_update_phone(p_phone text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_otp            phone_otps%ROWTYPE;
  v_conflict_count INT;
  v_dup_count      INT;
  v_digits         TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
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

  SELECT COUNT(*) INTO v_conflict_count
  FROM user_profiles
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '[^0-9]', '', 'g') = v_digits
    AND user_id           != v_uid
    AND withdrawal_status = 'requested';

  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '이미 탈퇴 유예기간 중인 계정이 있습니다. 기존 계정으로 로그인해 주세요.',
      'error_code', 'withdrawal_conflict'
    );
  END IF;

  SELECT COUNT(*) INTO v_dup_count
  FROM user_profiles
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '[^0-9]', '', 'g') = v_digits
    AND user_id != v_uid;

  IF v_dup_count > 0 THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '이미 가입된 휴대폰 번호입니다.',
      'error_code', 'phone_duplicate'
    );
  END IF;

  UPDATE phone_otps SET verified_at = now() WHERE id = v_otp.id;

  UPDATE user_profiles
  SET phone      = p_phone,
      updated_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_and_update_phone(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_and_update_phone(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_update_phone(text, text) TO authenticated, service_role;

-- ── ROLLBACK ── #370 본문(문자열 정확 일치 비교)으로 되돌린다.
