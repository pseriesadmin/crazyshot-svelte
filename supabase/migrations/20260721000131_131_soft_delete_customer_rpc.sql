-- migration 131: 회원 소프트 삭제 RPC
-- 용도: CMS manager/superadmin 전용 — user_profiles.deleted_at 설정
-- 예약·대여 기록은 user_id FK 유지 (auth.users 삭제 안 함)
-- rollback:
-- DROP FUNCTION IF EXISTS soft_delete_customer(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION soft_delete_customer(
  p_user_id    UUID,
  p_deleted_by TEXT,   -- 삭제 실행한 관리자 email
  p_reason     TEXT DEFAULT '관리자 삭제'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- 이미 삭제된 계정인지 확인
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = p_user_id AND deleted_at IS NOT NULL
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 삭제된 계정입니다.');
  END IF;

  -- 소프트 삭제: deleted_at 설정 + 식별정보 마스킹
  UPDATE user_profiles
  SET
    deleted_at = NOW(),
    name       = '[삭제된 계정]',
    phone      = NULL,
    blacklisted = false
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_customer(UUID, TEXT, TEXT) TO service_role;
