-- migration #133: user_notification_settings
-- 사용자 알림 설정 (대여예약 / 혜택) 컬럼 + RPC
-- Dependencies: 03_user_profiles.sql

-- 1. user_profiles에 알림 설정 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS allow_rental_alert  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_benefit_alert BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.allow_rental_alert  IS '대여예약 정보 알림 허용 여부 (기본: 허용)';
COMMENT ON COLUMN user_profiles.allow_benefit_alert IS '혜택 정보 알림 허용 여부 (기본: 거부)';

-- 2. 사용자가 자신의 알림 설정을 변경하는 RPC
CREATE OR REPLACE FUNCTION public.update_notification_settings(
  p_rental_alert  BOOLEAN,
  p_benefit_alert BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET
    allow_rental_alert  = p_rental_alert,
    allow_benefit_alert = p_benefit_alert,
    updated_at          = NOW()
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_notification_settings(BOOLEAN, BOOLEAN) TO authenticated;
