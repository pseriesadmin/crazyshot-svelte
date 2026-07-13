-- Migration #105: update_customer_info RPC
-- 관리자가 고객 기본정보(이름·이메일·전화번호·회원유형·가입일)를 수정하는 SECURITY DEFINER 함수
-- 2026-07-13

-- member_type CHECK 제약 제거 (B2C/B2B 고정 → 자유 텍스트로 변경)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_member_type_check;

-- 권한 확인은 서버 액션(+page.server.ts updateCustomerInfo)에서 수행
-- service_role 클라이언트로 호출 시 auth.uid()가 NULL이 되므로 RPC 내부 is_cms_user() 제거
CREATE OR REPLACE FUNCTION update_customer_info(
  p_user_id      UUID,
  p_name         TEXT         DEFAULT NULL,
  p_email        TEXT         DEFAULT NULL,
  p_phone        TEXT         DEFAULT NULL,
  p_member_type  TEXT         DEFAULT NULL,
  p_created_at   TIMESTAMPTZ  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET
    full_name   = CASE WHEN p_name        IS NOT NULL THEN p_name        ELSE full_name   END,
    email       = CASE WHEN p_email       IS NOT NULL THEN p_email       ELSE email       END,
    phone       = CASE WHEN p_phone       IS NOT NULL THEN p_phone       ELSE phone       END,
    member_type = CASE WHEN p_member_type IS NOT NULL THEN p_member_type ELSE member_type END,
    created_at  = CASE WHEN p_created_at  IS NOT NULL THEN p_created_at  ELSE created_at  END,
    updated_at  = NOW()
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사용자를 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_info TO authenticated;
