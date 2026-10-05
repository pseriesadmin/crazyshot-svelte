-- Migration #647: 크레이지로그 글 삭제 권한 — 사용자 글은 매니저 이상, 관리자 글은 모든 관리자
-- 배경(2026-10-05, Stephen 확정):
--  · 콘텐츠 등록관리는 전체 관리 기능 중 최하등급 — 관리자 계정이면 누구나 모든 콘텐츠를 등록·수정·비공개할 수 있다(기존 RPC가 이미 허용: update_user_post·set_post_public).
--  · 삭제만 구분한다: 작성자가 관리자 계정(cms_role 보유)인 글 = 모든 관리자 / 일반 사용자가 쓴 글 = 매니저·슈퍼마스터만.
--  · 기존 update_post_status는 삭제도 모든 관리자(is_cms_user)에게 허용했고, user_posts UPDATE RLS도 is_cms_user()라 RPC를 우회한 직접 UPDATE로도 파트너가 삭제할 수 있었다 → RPC와 트리거 양쪽에서 같은 규칙을 집행한다.
--  · "관리자 글" 판정은 작성자의 현재 cms_role 기준(작성자가 나중에 관리자에서 해제되면 사용자 글로 취급).
--  · 영향 범위: status 를 'deleted' 로 바꾸는 경우에만 작용. 비공개(is_public)·보류(hidden)·공개 전환·수정은 변경 없음. 작성자 본인 삭제(delete_own_post)·service_role(auth.uid() NULL)은 영향 없음.

-- 1) 매니저 이상 판별 (cmsPermissions.ts ROLE_LEVEL ≥ 50 = manager·superadmin)
CREATE OR REPLACE FUNCTION public.is_cms_manager_or_above()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_cms_manager_or_above() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_cms_manager_or_above() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_cms_manager_or_above() TO authenticated;

-- 2) 삭제 가능 여부 — 작성자 본인 / 관리자 글은 모든 관리자 / 사용자 글은 매니저 이상
CREATE OR REPLACE FUNCTION public.can_delete_user_post(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_owner = v_uid THEN
    RETURN TRUE;
  END IF;
  IF NOT public.is_cms_user() THEN
    RETURN FALSE;
  END IF;
  -- 작성자가 관리자 계정이면 모든 관리자 허용
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_owner AND cms_role IS NOT NULL) THEN
    RETURN TRUE;
  END IF;
  -- 일반 사용자 글은 매니저 이상만
  RETURN public.is_cms_manager_or_above();
END;
$$;

REVOKE ALL ON FUNCTION public.can_delete_user_post(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_delete_user_post(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_delete_user_post(UUID) TO authenticated;

-- 3) update_post_status — 삭제 시 위 규칙 적용(그 외 상태 변경은 기존과 동일: 모든 관리자)
CREATE OR REPLACE FUNCTION public.update_post_status(
  p_id     UUID,
  p_status TEXT
)
RETURNS public.user_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post  public.user_posts;
  v_owner UUID;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'forbidden: cms_role required';
  END IF;

  IF p_status NOT IN ('draft', 'published', 'hidden', 'deleted') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  IF p_status = 'deleted' THEN
    SELECT user_id INTO v_owner FROM public.user_posts WHERE id = p_id;
    IF FOUND AND NOT public.can_delete_user_post(v_owner) THEN
      RAISE EXCEPTION 'forbidden: manager role required to delete user content';
    END IF;
  END IF;

  UPDATE public.user_posts
    SET status = p_status
  WHERE id = p_id
  RETURNING * INTO v_post;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  RETURN v_post;
END;
$$;

-- 4) RPC를 우회한 직접 UPDATE(RLS user_posts_update = 본인 또는 is_cms_user)도 같은 규칙으로 차단
--    auth.uid() IS NULL(service_role·SQL 에디터·크론)은 통과 — 서버 신뢰 경로 영향 없음.
CREATE OR REPLACE FUNCTION public.user_posts_guard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_delete_user_post(OLD.user_id) THEN
    RAISE EXCEPTION 'forbidden: manager role required to delete user content';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_posts_guard_delete ON public.user_posts;
CREATE TRIGGER trg_user_posts_guard_delete
  BEFORE UPDATE OF status ON public.user_posts
  FOR EACH ROW
  WHEN (NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted')
  EXECUTE FUNCTION public.user_posts_guard_delete();

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_user_posts_guard_delete ON public.user_posts;
--   DROP FUNCTION IF EXISTS public.user_posts_guard_delete();
--   (update_post_status 는 migration 117 정의로 CREATE OR REPLACE 복원)
--   DROP FUNCTION IF EXISTS public.can_delete_user_post(UUID);
--   DROP FUNCTION IF EXISTS public.is_cms_manager_or_above();
