-- Migration #352: CMS 메뉴별 세부 접근권한(cms_menu_permissions) CRUD RPC
--
-- .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 3
-- (Migration #350이 만든 cms_menu_permissions 테이블·RLS를 그대로 사용 — 스키마 변경 없음)
--
-- 설계 원칙(Stage 2 requireAccountMutationAccess와 동일 철학):
--   이 RPC들은 "단순 데이터 계층"이며, 인가·업무규칙(누가 호출 가능한가, allowed=true가
--   role 상한선을 넘는지 — Q6)은 이 함수 내부가 아니라 이를 호출하는 서버 API
--   (src/routes/api/cms/accounts/[id]/menu-permissions/+server.ts)가 담당한다. 그 API는
--   호출 전 이미 manager+ 게이트(hasSettingsAccess) + EC-5(자기 자신 대상 차단) +
--   Q6(role 상한선을 넘는 allowed=true 거부, src/lib/constants/cmsMenus.ts
--   roleAllowsMenuByDefault() 재사용)를 강제하고, 검증을 통과한 요청만 이 RPC로 전달한다.
--   RPC 자체는 SECURITY DEFINER이며 "누가 호출했는지"를 신뢰성 있게 판단할 근거가 없으므로
--   (Stage 2 §핵심제약과 동일 이유), service_role 전용으로 REVOKE해 anon/authenticated의
--   직접 호출을 원천 차단하는 것이 실질적 방어선이다.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- 1. cms_get_menu_permissions — 특정 계정의 메뉴권한 오버레이 전체 조회
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_get_menu_permissions(
  p_user_id UUID
)
RETURNS TABLE (
  menu_key   TEXT,
  allowed    BOOLEAN,
  updated_at TIMESTAMPTZ,
  updated_by UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT menu_key, allowed, updated_at, updated_by
  FROM cms_menu_permissions
  WHERE user_id = p_user_id
  ORDER BY menu_key;
$$;

REVOKE EXECUTE ON FUNCTION cms_get_menu_permissions(UUID)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. cms_set_menu_permission — 메뉴 1건의 허용/차단 upsert
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_set_menu_permission(
  p_target_user_id UUID,
  p_menu_key       TEXT,
  p_allowed        BOOLEAN,
  p_actor_id       UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_menu_key IS NULL OR trim(p_menu_key) = '' THEN
    RAISE EXCEPTION 'invalid_menu_key: menu_key must not be empty';
  END IF;

  INSERT INTO cms_menu_permissions (user_id, menu_key, allowed, updated_by, updated_at)
  VALUES (p_target_user_id, p_menu_key, p_allowed, p_actor_id, NOW())
  ON CONFLICT (user_id, menu_key)
  DO UPDATE SET
    allowed    = EXCLUDED.allowed,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_set_menu_permission(UUID, TEXT, BOOLEAN, UUID)
  FROM anon, authenticated;
