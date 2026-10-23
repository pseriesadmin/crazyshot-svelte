-- Migration 749 — soft_delete_customer: 존재하지 않는 칼럼(name) → full_name (2026-10-23)
--
-- 배경: CMS 회원 삭제가 항상 `column "name" of relation "user_profiles" does not exist`로 실패했다.
--       함수(Migration #131 원본)가 user_profiles.name에 '[삭제된 계정]'을 쓰는데 실제 칼럼은 full_name뿐이다(Stage·Production 동일).
-- 수정: name → full_name. 그 외 동작(번호 비우기·블랙리스트 해제·이미 삭제된 계정 안내)과 시그니처·권한(service_role 전용)은 그대로.
--       이메일은 이번 범위에서 건드리지 않는다(별도 결정).

CREATE OR REPLACE FUNCTION public.soft_delete_customer(p_user_id uuid, p_deleted_by text, p_reason text DEFAULT '관리자 삭제'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = p_user_id AND deleted_at IS NOT NULL
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 삭제된 계정입니다.');
  END IF;

  UPDATE user_profiles
  SET
    deleted_at  = NOW(),
    full_name   = '[삭제된 계정]',
    phone       = NULL,
    blacklisted = false
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.soft_delete_customer(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.soft_delete_customer(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_customer(uuid, text, text) TO service_role;

-- ── ROLLBACK ── #131 원본 본문(name 칼럼 사용)으로 되돌리면 삭제는 다시 실패한다(되돌릴 이유 없음).
