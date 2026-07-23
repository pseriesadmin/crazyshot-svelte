-- Migration 135: Production DB용 RPC 수정
-- 목적: Production user_profiles는 PK가 id (UUID) — user_id 컬럼 없음
--       Migration #132, #133의 WHERE user_id = ... 를 WHERE id = ... 로 교체
-- 주의: Stage DB에는 user_id alias 컬럼이 존재하므로 영향 없음

-- 1. update_user_profile: WHERE id = v_uid 로 교체
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
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_profile(TEXT, TEXT, DATE) TO authenticated;

-- 2. update_notification_settings: WHERE id = auth.uid() 로 교체
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
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '프로필을 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_notification_settings(BOOLEAN, BOOLEAN) TO authenticated;
